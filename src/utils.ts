export function bufferAddFactory(bufferLength: number) {
  return function (buffer1: Buffer, buffer2: Buffer) {
    if (buffer1.length !== bufferLength || buffer2.length !== bufferLength) {
      throw new Error(
        `Both buffers must have a length of ${bufferLength} bytes`,
      )
    }

    const result = Buffer.alloc(bufferLength)
    let carry = 0 // 初始化进位为0

    // 从最低有效字节开始逐个加
    for (let i = bufferLength - 1; i >= 0; i--) {
      const sum = buffer1[i] + buffer2[i] + carry
      result[i] = sum % 256 // 当前字节加和，取模确保字节在 0-255 范围内
      carry = Math.floor(sum / 256) // 计算进位
    }

    // 如果有进位且 result 中有溢出（即carry不为0），需要丢弃
    return result
  }
}

export function number2Buffer(value: number, bufferLength: number) {
  // 检查 bufferLength 是否小于 4
  if (bufferLength < 4) {
    throw new Error('bufferLength must be greater than or equal to 4')
  }

  const buffer = Buffer.alloc(bufferLength)
  buffer.writeUint32BE(value, bufferLength - 4)
  return buffer
}

export const bufferAdd16Bytes = bufferAddFactory(16)

export function parseContentRange(contentRange: string) {
  // 使用正则表达式解析 Content-Range 格式
  const rangeRegex = /bytes (\d+)-(\d+)\/(\d+)/
  const match = contentRange.match(rangeRegex)

  if (!match) {
    throw new Error('Invalid Content-Range format')
  }

  // 提取 start, end 和 total 字节数
  const start = parseInt(match[1], 10)
  const end = parseInt(match[2], 10)
  const total = parseInt(match[3], 10)

  return {
    start,
    end,
    total,
  }
}
