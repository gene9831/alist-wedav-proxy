import { XMLBuilder } from 'fast-xml-parser'
import { parseXML } from './dav/dav'

const xmlStr =
  '<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/TV-Shows/Test/</D:href><D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype><D:displayname>Test</D:displayname><D:creationdate>2025-02-16T03:21:39Z</D:creationdate><D:supportedlock><D:lockentry xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock><D:getlastmodified>Sun, 16 Feb 2025 03:22:13 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>/dav/TV-Shows/Test/encrypted.json</D:href><D:propstat><D:prop><D:supportedlock><D:lockentry xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock><D:getlastmodified>Sat, 15 Feb 2025 18:24:05 GMT</D:getlastmodified><D:getcontenttype>application/json</D:getcontenttype><D:resourcetype></D:resourcetype><D:displayname>encrypted.json</D:displayname><D:getcontentlength>267</D:getcontentlength><D:creationdate>2025-02-16T03:21:58Z</D:creationdate><D:getetag>"182474dc5dd9400010b"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>/dav/TV-Shows/Test/encrypted.mp4</D:href><D:propstat><D:prop><D:resourcetype></D:resourcetype><D:displayname>encrypted.mp4</D:displayname><D:getcontentlength>406240008</D:getcontentlength><D:creationdate>2025-02-16T03:22:13Z</D:creationdate><D:getetag>"182474ba72a4dc001836bb08"</D:getetag><D:getlastmodified>Sat, 15 Feb 2025 18:21:40 GMT</D:getlastmodified><D:getcontenttype>video/mp4</D:getcontenttype><D:supportedlock><D:lockentry xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>'

function addNamespaces(
  obj: Record<string, any>,
  nsPrefix: string,
  ns: string,
): Record<string, any> {
  if (typeof obj !== 'object' || obj === null) {
    return obj // 如果是基本类型（非对象），则直接返回
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => addNamespaces(item, nsPrefix, ns)) // 如果是数组，递归处理每一项
  }

  if ('multistatus' in obj) {
    obj.multistatus[`@xmlns:${nsPrefix}`] = ns
  }

  // 如果是对象，遍历每个键并加上前缀
  const result = Object.entries(obj).reduce((result, [key, value]) => {
    const newKey =
      key.startsWith('@') || key === 'text' ? key : `${nsPrefix}:${key}`
    result[newKey] = addNamespaces(value, nsPrefix, ns) // 递归处理值
    return result
  }, {} as Record<string, any>)

  return result
}

const main = async () => {
  const parsed = await parseXML(xmlStr)
  console.log(JSON.stringify(parsed))

  const builder = new XMLBuilder({
    attributeNamePrefix: '@',
    textNodeName: 'text',
    ignoreAttributes: false,
  })

  const data = addNamespaces(parsed, 'D', 'DAV:')
  console.log(builder.build(data))
}

main()
