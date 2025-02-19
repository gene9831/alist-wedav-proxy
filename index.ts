import type { Request, Response } from 'express'
import express from 'express'
import http from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { jsonObj2XML, parseXML, validateXML } from './dav/dav'
import type { DAVResult, DAVResultResponse } from './dav/types'

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // 转义所有特殊字符
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
        throw new Error('InvalidXML')
      }

      const result = await parseXML(xmlStr)
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
        throw new Error()
      }

      const encPairResps: {
        key: DAVResultResponse
        data: DAVResultResponse
      }[] = []

      for (const keyResp of encKeyResps) {
        const prefix = keyResp.href.replace('enc-key.json', '')
        const regExp = new RegExp(
          `^${escapeRegex(prefix)}enc-data\\.[a-zA-Z0-9]+$`,
        )
        const dataResp = encDataResps.find((item) => regExp.test(item.href))
        if (dataResp) {
          encPairResps.push({ key: keyResp, data: dataResp })
        }
      }

      for (const { key, data } of encPairResps) {
        const url = new URL(webdavTarget)
        url.pathname = key.href

        const resp = await fetch(url, {
          method: 'GET',
          headers: { authorization: req.headers.authorization || '' },
        })

        const metaData = await resp.json()

        const copied = structuredClone(data)

        copied.href = copied.href
          .split('/')
          .slice(0, -1)
          .concat(encodeURIComponent(metaData.filename))
          .join('/')

        if (copied.propstat?.prop.displayname) {
          copied.propstat.prop.displayname = metaData.filename
        }

        // TODO 还需要处理文件的 PROPFIND 和 GET
        normalResps.push(copied)
      }

      const newResult: DAVResult = {
        multistatus: { response: normalResps },
      }

      const newData = jsonObj2XML(newResult)

      res.write(newData, 'utf-8')
    } catch (err) {
      // console.log(err)
      res.write(data)
    } finally {
      res.end()
    }
  })
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
    on: {
      proxyReq: (proxyReq, req, res) => {
        console.log(req.headers)
      },
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
