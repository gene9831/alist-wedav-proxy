import crypto from 'crypto'
import type { Request, Response } from 'express'
import express from 'express'
import http from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { createCache } from './cache'
import {
  jsonObj2XML,
  parseXML,
  validateXML,
  type DAVResult,
  type DAVResultResponse,
} from './dav'
import { bufferAdd16Bytes, number2Buffer, parseContentRange } from './utils'

interface EncKeyData {
  filename: string
  algorithm: string
  key: string
  iv: string
}

declare global {
  namespace Express {
    interface Request {
      context?: {
        enc: boolean
        originPathname: string
      } & Record<string, any>
    }
  }
}

// WebDAV 服务器的地址
const webdavUpstreamURL = new URL('http://192.168.100.12:5244/dav')
const proxyRoute = '/mydav'

const encKeyDataCache = createCache<EncKeyData>({ cacheId: 'enc-key-data' })
// TODO 下面两个map要不要转换成cache，写类似getEncKeyData来获取
const keyDataPathMap = new Map<string, string>()
const pathRewriteMap = new Map<string, string>()

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // 转义所有特殊字符
}

const getEncKeyData = async (
  keyUrl: URL,
  headers: http.IncomingHttpHeaders,
) => {
  const cached = encKeyDataCache.get(keyUrl.pathname)

  if (cached) {
    return cached
  }

  const resp = await fetch(keyUrl, {
    method: 'GET',
    headers: { authorization: headers.authorization || '' },
  })
  const result: EncKeyData = await resp.json()
  encKeyDataCache.set(keyUrl.pathname, result)

  return result
}

const renameDAVResultResponse = (
  davResp: DAVResultResponse,
  newName: string,
) => {
  const newHref = davResp.href
    .split('/')
    .slice(0, -1)
    .concat(encodeURIComponent(newName))
    .join('/')

  const copied = structuredClone(davResp)

  copied.href = newHref

  if (copied.propstat?.prop.displayname) {
    copied.propstat.prop.displayname = newName
  }

  pathRewriteMap.set(copied.href, davResp.href)

  return copied
}

const handlePropfindList = async (result: DAVResult, req: Request) => {
  const responses = result.multistatus.response

  // 匹配例如 xxx-enc-key.json
  const keyNameRegExp = /^(.+-)?enc-key\.json$/
  // 匹配例如 xxx-enc-data.mp4
  const dataNameRegExp = /^(.+-)?enc-data\.[a-zA-Z0-9]+$/

  const encKeyResps: DAVResultResponse[] = []
  const encDataResps: DAVResultResponse[] = []
  const normalResps: DAVResultResponse[] = []

  for (const resp of responses) {
    if (
      keyNameRegExp.test(resp.href) &&
      !resp.propstat?.prop.resourcetype.collection
    ) {
      encKeyResps.push(resp)
    } else if (
      dataNameRegExp.test(resp.href) &&
      !resp.propstat?.prop.resourcetype.collection
    ) {
      encDataResps.push(resp)
    } else {
      normalResps.push(resp)
    }
  }

  if (encKeyResps.length === 0) {
    throw new Error('Encrypted data not found')
  }

  const encPairResps: {
    key: DAVResultResponse
    data: DAVResultResponse
  }[] = []

  for (const keyResp of encKeyResps) {
    const prefix = keyResp.href.replace('enc-key.json', '')
    const regExp = new RegExp(`^${escapeRegex(prefix)}enc-data\\.[a-zA-Z0-9]+$`)
    const dataResp = encDataResps.find((item) => regExp.test(item.href))
    if (dataResp) {
      encPairResps.push({ key: keyResp, data: dataResp })
    }
  }

  for (const { key, data } of encPairResps) {
    keyDataPathMap.set(key.href, data.href)
    keyDataPathMap.set(data.href, key.href)

    const keyUrl = new URL(key.href, webdavUpstreamURL)
    const encKeyData = await getEncKeyData(keyUrl, req.headers)
    const newResp = renameDAVResultResponse(data, encKeyData.filename)

    normalResps.push(newResp)
  }

  return jsonObj2XML({
    multistatus: { response: normalResps },
  })
}

const handlePropfindEnc = async (result: DAVResult, req: Request) => {
  const responses = result.multistatus.response

  const newResps = await Promise.all(
    responses.map(async (item) => {
      const dataPath = req.context!.originPathname
      if (item.href === dataPath) {
        const keyPath = keyDataPathMap.get(dataPath)

        if (!keyPath) {
          return item
        }

        const keyUrl = new URL(keyPath, webdavUpstreamURL)
        const encKeyData = await getEncKeyData(keyUrl, req.headers)
        return renameDAVResultResponse(item, encKeyData.filename)
      }
      return item
    }),
  )

  return jsonObj2XML({
    multistatus: { response: newResps },
  })
}

const handlePropfind = (
  proxyRes: http.IncomingMessage,
  req: Request,
  res: Response,
) => {
  const buffers: Buffer[] = []

  proxyRes.on('data', (chunk) => {
    buffers.push(chunk)
  })

  proxyRes.on('close', () => {
    res.emit('close')
  })

  proxyRes.on('end', async () => {
    const data = Buffer.concat(buffers)

    try {
      const xmlStr = data.toString('utf-8')

      if (!validateXML(xmlStr)) {
        throw new Error('Invalid XML')
      }

      const result = await parseXML(xmlStr)

      let newData: string
      if (req.context?.enc) {
        newData = await handlePropfindEnc(result, req)
      } else {
        newData = await handlePropfindList(result, req)
      }

      res.write(newData, 'utf-8')
    } catch (err) {
      res.write(data)
    } finally {
      res.end()
    }
  })
}

// TODO 需要流量控制
const handleGetEnc = async (
  proxyRes: http.IncomingMessage,
  req: Request,
  res: Response,
) => {
  const dataPath = req.context!.originPathname
  const keyPath = keyDataPathMap.get(dataPath)

  if (!keyPath) {
    proxyRes.pipe(res)
    return
  }

  const keyUrl = new URL(keyPath, webdavUpstreamURL)
  const encKeyData = await getEncKeyData(keyUrl, req.headers)

  const key = Buffer.from(encKeyData.key, 'hex')
  const iv = Buffer.from(encKeyData.iv, 'hex')

  const getOffset = () => {
    if (!proxyRes.headers['content-range']) {
      return 0
    }

    const { start } = parseContentRange(proxyRes.headers['content-range'])
    console.log(proxyRes.headers['content-range'])
    console.log(start)
    return start
  }

  let offset = getOffset()

  proxyRes.on('data', (chunk) => {
    const blockIndex = Math.floor(offset / 16)
    const dummyBufferLen = offset % 16
    const newIv = bufferAdd16Bytes(iv, number2Buffer(blockIndex, 16))
    const chunkWithDummy = Buffer.concat([Buffer.alloc(dummyBufferLen), chunk])
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, newIv)
    const decrypted = Buffer.concat([
      decipher.update(chunkWithDummy),
      decipher.final(),
    ]).subarray(dummyBufferLen)

    res.write(decrypted)

    offset += chunk.length
  })

  proxyRes.on('end', () => {
    res.end()
  })
}

const app = express()

// 创建一个代理中间件，将所有请求代理到 WebDAV 服务器
app.use(
  proxyRoute,
  createProxyMiddleware<Request, Response>({
    target: webdavUpstreamURL.origin + webdavUpstreamURL.pathname,
    changeOrigin: true, // 修改请求头中的 Origin 字段，使其指向目标 WebDAV 服务器
    selfHandleResponse: true,
    logger: console,
    pathRewrite: (path, req) => {
      const originPathname = pathRewriteMap.get(`/dav${path}`)

      if (!originPathname) {
        return path
      }

      req.context = { enc: true, originPathname: originPathname }
      return originPathname.replace(/^\/dav/, '')
    },
    on: {
      proxyRes: (proxyRes, req, res) => {
        // 手动处理响应需要写入3部份数据：状态码、响应头部、响应体
        res.status(proxyRes.statusCode || 404)

        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          value && res.setHeader(key, value)
        })

        try {
          if (
            req.method.toUpperCase() === 'PROPFIND' &&
            proxyRes.statusCode === 207
          ) {
            handlePropfind(proxyRes, req, res)
          } else if (
            req.method.toUpperCase() === 'GET' &&
            proxyRes.statusCode &&
            proxyRes.statusCode >= 200 &&
            proxyRes.statusCode < 300 &&
            req.context?.enc
          ) {
            handleGetEnc(proxyRes, req, res)
          } else {
            proxyRes.pipe(res)
          }
        } catch (err) {
          res.status(500)
          res.end()
        }
      },
    },
  }),
)

// 启动服务器，监听 8080 端口
app.listen(8080, () => {
  console.log('代理服务器已启动，监听端口 8080...')
})
