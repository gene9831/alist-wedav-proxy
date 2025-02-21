import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import nestedProp from 'nested-property'
import type {
  DAVResult,
  DAVResultRaw,
  DAVResultResponse,
  WebDAVParsingContext,
} from './types.ts'

enum PropertyType {
  Array = 'array',
  Object = 'object',
  Original = 'original',
}

function getParser({
  attributeNamePrefix,
  attributeParsers,
  tagParsers,
}: WebDAVParsingContext): XMLParser {
  return new XMLParser({
    allowBooleanAttributes: true,
    attributeNamePrefix,
    textNodeName: 'text',
    ignoreAttributes: false,
    removeNSPrefix: true,
    numberParseOptions: {
      hex: true,
      leadingZeros: false,
    },
    attributeValueProcessor(_, attrValue, jPath) {
      for (const processor of attributeParsers) {
        try {
          const value = processor(jPath, attrValue)
          if (value !== attrValue) {
            return value
          }
        } catch (error) {
          // skipping this invalid parser
        }
      }
      return attrValue
    },
    tagValueProcessor(tagName, tagValue, jPath) {
      for (const processor of tagParsers) {
        try {
          const value = processor(jPath, tagValue)
          if (value !== tagValue) {
            return value
          }
        } catch (error) {
          // skipping this invalid parser
        }
      }
      return tagValue
    },
  })
}

/**
 * Tag parser for the displayname prop.
 * Ensure that the displayname is not parsed and always handled as is.
 * @param path The jPath of the tag
 * @param value The text value of the tag
 */
export function displaynameTagParser(
  path: string,
  value: string,
): string | void {
  if (path.endsWith('propstat.prop.displayname')) {
    // Do not parse the displayname, because this causes e.g. '2024.10' to result in number 2024.1
    return
  }
  return value
}

function getPropertyOfType(
  obj: Object,
  prop: string,
  type: PropertyType = PropertyType.Original,
): any {
  const val = nestedProp.get(obj, prop)
  if (type === PropertyType.Array && Array.isArray(val) === false) {
    return [val]
  } else if (type === PropertyType.Object && Array.isArray(val)) {
    return val[0]
  }
  return val
}

function normaliseResponse(response: any): DAVResultResponse {
  const output = Object.assign({}, response)
  // Only either status OR propstat is allowed
  if (output.status) {
    nestedProp.set(
      output,
      'status',
      getPropertyOfType(output, 'status', PropertyType.Object),
    )
  } else {
    nestedProp.set(
      output,
      'propstat',
      getPropertyOfType(output, 'propstat', PropertyType.Object),
    )
    nestedProp.set(
      output,
      'propstat.prop',
      getPropertyOfType(output, 'propstat.prop', PropertyType.Object),
    )
  }
  return output
}

function normaliseResult(result: DAVResultRaw): DAVResult {
  const { multistatus } = result
  if (multistatus === '') {
    return {
      multistatus: {
        response: [],
      },
    }
  }
  if (!multistatus) {
    throw new Error('Invalid response: No root multistatus found')
  }
  const output: any = {
    multistatus: Array.isArray(multistatus) ? multistatus[0] : multistatus,
  }
  nestedProp.set(
    output,
    'multistatus.response',
    getPropertyOfType(output, 'multistatus.response', PropertyType.Array),
  )
  nestedProp.set(
    output,
    'multistatus.response',
    nestedProp
      .get(output, 'multistatus.response')
      .map((response: any) => normaliseResponse(response)),
  )
  return output as DAVResult
}

/**
 * Parse an XML response from a WebDAV service,
 *  converting it to an internal DAV result
 * @param xml The raw XML string
 * @param context The current client context
 * @returns A parsed and processed DAV result
 */
export function parseXML(
  xml: string,
  context?: WebDAVParsingContext,
): Promise<DAVResult> {
  // backwards compatibility as this method is exported from the package
  context = context ?? {
    attributeNamePrefix: '@',
    attributeParsers: [],
    tagParsers: [displaynameTagParser],
  }
  return new Promise((resolve) => {
    const result = getParser(context).parse(xml)
    resolve(normaliseResult(result))
  })
}

function addNamespaceDeclaration(
  obj: any,
  key: string,
  nsPrefix: string,
  ns: string,
) {
  if (!(key in obj)) {
    return
  }

  if (typeof obj[key] === 'object' && obj[key] !== null) {
    obj[key][`@xmlns:${nsPrefix}`] = ns
  } else if (typeof obj[key] === 'string') {
    const text = obj[key]
    obj[key] = {
      [`@xmlns:${nsPrefix}`]: ns,
      text,
    }
  }
}

const keysToAddNSDeclaration = ['multistatus', 'collection', 'lockentry']

function addNamespaces(obj: any, nsPrefix: string, ns: string): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj // 如果是基本类型（非对象），则直接返回
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => addNamespaces(item, nsPrefix, ns)) // 如果是数组，递归处理每一项
  }

  keysToAddNSDeclaration.forEach((key) =>
    addNamespaceDeclaration(obj, key, nsPrefix, ns),
  )

  // 如果是对象，遍历每个键并加上前缀
  const result = Object.entries(obj).reduce((result, [key, value]) => {
    const newKey =
      key.startsWith('@') || key === 'text' ? key : `${nsPrefix}:${key}`
    result[newKey] = addNamespaces(value, nsPrefix, ns) // 递归处理值
    return result
  }, {} as any)

  return result
}

export function jsonObj2XML(obj: any) {
  const builder = new XMLBuilder({
    attributeNamePrefix: '@',
    textNodeName: 'text',
    ignoreAttributes: false,
  })

  const data = addNamespaces(obj, 'D', 'DAV:')

  const res = builder.build(data)

  // TODO 这里直接加上 encoding="UTF-8" 是否可行
  return `<?xml version="1.0" encoding="UTF-8"?>${res}`
}

export const validateXML = (xmlData: string) =>
  XMLValidator.validate(xmlData, { allowBooleanAttributes: true })
