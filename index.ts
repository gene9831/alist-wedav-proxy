import type { Request, Response } from 'express'
import express from 'express'
import {
  createProxyMiddleware,
  responseInterceptor,
} from 'http-proxy-middleware'
import { parseStringPromise, Builder } from 'xml2js'

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
    on: {
      proxyReq: (proxyReq, req, res) => {
        console.log(`代理请求: ${req.method} ${req.url}`)
      },
      proxyRes: responseInterceptor(
        async (responseBuffer, proxyRes, req, res) => {
          if (!/xml/.test(proxyRes.headers['content-type'] || '')) {
            return responseBuffer
          }

          // "text/xml; charset=utf-8"
          const data = responseBuffer.toString('utf-8')

          try {
            // 解析 XML 数据
            const result = await parseStringPromise(data)

            // 在 XML 中新增一个目录响应
            const testDirectory = {
              'D:href': ['/dav/Test/'],
              'D:propstat': [
                {
                  'D:prop': [
                    {
                      'D:displayname': ['Test'],
                    },
                  ],
                  'D:status': ['HTTP/1.1 200 OK'],
                },
              ],
            }

            if (result['D:multistatus']) {
              const response = result['D:multistatus']['D:response']
              if (Array.isArray(response)) {
                result['D:multistatus']['D:response'] =
                  response.concat(testDirectory)
              } else {
                result['D:multistatus']['D:response'] = [testDirectory]
              }
            }

            const newData = new Builder({
              renderOpts: { pretty: false, indent: '', newline: '' },
            }).buildObject(result)

            return newData
          } catch (err) {
            console.error('解析 XML 错误', err)
            return data
          }
        },
      ),
    },
  }),
)

// 启动服务器，监听 8080 端口
app.listen(8080, () => {
  console.log('代理服务器已启动，监听端口 8080...')
})
