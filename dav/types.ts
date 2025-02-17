export type AuthHeader = string

export enum AuthType {
  Auto = 'auto',
  Digest = 'digest',
  None = 'none',
  Password = 'password',
  Token = 'token',
}

export type BufferLike = Buffer | ArrayBuffer

/** <propstat> as per http://www.webdav.org/specs/rfc2518.html#rfc.section.12.9.1.1 */
interface DAVPropStat {
  prop: DAVResultResponseProps
  status: string
  responsedescription?: string
}

/**
 * DAV response can either be (href, propstat, responsedescription?) or (href, status, responsedescription?)
 * @see http://www.webdav.org/specs/rfc2518.html#rfc.section.12.9.1
 */
interface DAVResultBaseResponse {
  href: string
  responsedescription?: string
}

export interface DAVResultPropstatResponse extends DAVResultBaseResponse {
  propstat: DAVPropStat
}

export interface DAVResultStatusResponse extends DAVResultBaseResponse {
  status: string
}

export type DAVResultResponse = DAVResultBaseResponse &
  Partial<DAVResultPropstatResponse> &
  Partial<DAVResultStatusResponse>

export interface DAVResultResponseProps {
  displayname: string
  resourcetype: {
    collection?: unknown
  }
  getlastmodified?: string
  getetag?: string
  getcontentlength?: string
  getcontenttype?: string
  'quota-available-bytes'?: string | number
  'quota-used-bytes'?: string | number

  [additionalProp: string]: unknown
}

export interface DAVResult {
  multistatus: {
    response: Array<DAVResultResponse>
  }
}

export interface DAVResultRawMultistatus {
  response: DAVResultResponse | [DAVResultResponse]
}

export interface DAVResultRaw {
  multistatus: '' | DAVResultRawMultistatus | [DAVResultRawMultistatus]
}

/**
 * Callback to parse a prop attribute value.
 * If `undefined` is returned the original text value will be used.
 * If the unchanged value is returned the default parsing will be applied.
 * Otherwise the returned value will be used.
 */
export type WebDAVAttributeParser = (
  jPath: string,
  attributeValue: string,
) => string | unknown | undefined

/**
 * Callback to parse a prop tag value.
 * If `undefined` is returned the original text value will be used.
 * If the unchanged value is returned the default parsing will be applied.
 * Otherwise the returned value will be used.
 */
export type WebDAVTagParser = (
  jPath: string,
  tagValue: string,
) => string | unknown | undefined

export interface WebDAVParsingContext {
  attributeNamePrefix?: string
  attributeParsers: WebDAVAttributeParser[]
  tagParsers: WebDAVTagParser[]
}
