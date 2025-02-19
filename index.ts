import type { Request, Response } from 'express'
import express from 'express'
import { create, type FlatCacheOptions } from 'flat-cache'
import http from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { jsonObj2XML, parseXML, validateXML } from './dav/dav'
import type { DAVResult, DAVResultResponse } from './dav/types'

interface EncKeyData {
  filename: string
  algorithm: string
  key: string
  iv: string
}

interface EncContext {
  path: string
  originHref: string
  filename: string
}

function createCache<T>(options?: FlatCacheOptions) {
  const {
    ttl,
    lruSize,
    expirationInterval,
    persistInterval,
    cacheId,
    cacheDir,
    ...rest
  } = options || {}
  const cache = create({
    ttl: ttl || 60 * 60 * 1000, // 1 hour
    lruSize: lruSize || 1000, // 1,000 items
    expirationInterval: expirationInterval || 5 * 1000 * 60, // 5 minutes
    persistInterval: persistInterval || 5 * 1000 * 60, // 5 minutes
    cacheId,
    cacheDir: cacheDir || './cache',
    ...rest,
  })

  const set = (key: string, value: T) => cache.set(key, value)

  const get = (key: string): T | undefined => cache.get(key)

  return {
    cache,
    set,
    get,
  }
}

const keyContentCache = createCache<EncKeyData>({ cacheId: 'key-content' })
const encKeyDataCache = createCache<EncContext>({ cacheId: 'enc-context' })

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // 转义所有特殊字符
}

const renameDAVResultResponse = (
  davResp: DAVResultResponse,
  newName: string,
) => {
  const copied = structuredClone(davResp)
  copied.href = copied.href
    .split('/')
    .slice(0, -1)
    .concat(encodeURIComponent(newName))
    .join('/')

  encKeyDataCache.set(copied.href.replace(/^\/dav/, ''), {
    path: davResp.href.replace(/^\/dav/, ''),
    originHref: davResp.href,
    filename: newName,
  })

  if (copied.propstat?.prop.displayname) {
    copied.propstat.prop.displayname = newName
  }

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
    const url = new URL(webdavTarget)
    url.pathname = key.href

    // TODO 抽取函数
    let encKeyData = encKeyDataCache.get(url.pathname)

    if (!encKeyData) {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { authorization: req.headers.authorization || '' },
      })
      encKeyData = await resp.json()
      encKeyDataCache.set(url.pathname, encKeyData)
    }

    const newResp = renameDAVResultResponse(data, encKeyData.filename)

    // TODO 还需要处理文件的 GET
    normalResps.push(newResp)
  }

  return jsonObj2XML({
    multistatus: { response: normalResps },
  })
}

const handlePropfindEnc = (result: DAVResult, req: Request) => {
  const responses = result.multistatus.response

  const newResps = responses.map((item) => {
    const encContext = req.context!.encContext
    if (item.href === encContext.originHref) {
      return renameDAVResultResponse(item, encContext.filename)
    }
    return item
  })

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
        newData = handlePropfindEnc(result, req)
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

declare global {
  namespace Express {
    interface Request {
      context?: {
        enc: boolean
        encContext: EncContext
      } & Record<string, any>
    }
  }
}

const app = express()

// WebDAV 服务器的地址
const webdavTarget = 'http://192.168.100.12:5244/dav' // 替换为实际的 WebDAV 服务器地址

// 创建一个代理中间件，将所有请求代理到 WebDAV 服务器
app.use(
  '/dav',
  createProxyMiddleware<Request, Response>({
    target: webdavTarget,
    changeOrigin: true, // 修改请求头中的 Origin 字段，使其指向目标 WebDAV 服务器
    selfHandleResponse: true,
    logger: console,
    pathRewrite: (path, req) => {
      const encContext = encKeyDataCache.get(path)
      if (encContext) {
        req.context = { enc: true, encContext: encContext }
        return encContext.path
      }
      return path
    },
    on: {
      proxyRes: (proxyRes, req, res) => {
        // 手动处理响应需要写入3部份数据：状态码、响应头部、响应体
        res.status(proxyRes.statusCode || 404)

        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          value && res.setHeader(key, value)
        })

        if (
          req.method.toUpperCase() === 'PROPFIND' &&
          proxyRes.statusCode === 207
        ) {
          handlePropfind(proxyRes, req, res)
        } else {
          proxyRes.pipe(res)
        }
      },
    },
  }),
)

// 启动服务器，监听 8080 端口
app.listen(8080, () => {
  console.log('代理服务器已启动，监听端口 8080...')
})
