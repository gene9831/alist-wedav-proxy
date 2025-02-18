import type { Request, Response } from 'express'
import express from 'express'
import http from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { jsonObj2XML, parseXML, validateXML } from './dav/dav'

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

      const metaDataResp = responses.find((item) =>
        item.href.endsWith('encrypted.json'),
      )
      const encryptedDataResp = responses.find((item) =>
        item.href.endsWith('encrypted.mp4'),
      )

      if (!metaDataResp || !encryptedDataResp) {
        throw new Error()
      }

      const url = new URL(webdavTarget)
      url.pathname = metaDataResp.href

      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: req.headers.authorization || '',
        },
      })

      const metaData = await resp.json()

      const copiedMetaData = structuredClone(encryptedDataResp)

      copiedMetaData.href = copiedMetaData.href
        .split('/')
        .slice(0, -1)
        .concat(encodeURIComponent(metaData.filename))
        .join('/')

      if (copiedMetaData.propstat?.prop.displayname) {
        copiedMetaData.propstat.prop.displayname = metaData.filename
      }

      // TODO 还需要处理文件的 PROPFIND 和 GET
      responses.push(copiedMetaData)

      console.log(JSON.stringify(responses))

      const newData = jsonObj2XML(result)

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
