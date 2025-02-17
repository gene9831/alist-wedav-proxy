import crypto from 'crypto'

function bufferAddFactory(bufferLength: number) {
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

function number2Buffer(value: number, bufferLength: number) {
  // 检查 bufferLength 是否小于 4
  if (bufferLength < 4) {
    throw new Error('bufferLength must be greater than or equal to 4')
  }

  const buffer = Buffer.alloc(bufferLength)
  buffer.writeUint32BE(value, bufferLength - 4)
  return buffer
}

const bufferAdd16Bytes = bufferAddFactory(16)

const key = crypto.randomBytes(32) // 256位 AES 密钥
const iv = crypto.randomBytes(16) // 128位 IV（通常用于CTR模式）
// efb050612462586c5820186173f69da3
// 创建明文数据：连续的数字 0-9 重复 100 次
const plainText = '0123456789'.repeat(100) // 重复 100 次

// 创建 AES-CTR 模式的加密器
const cipher = crypto.createCipheriv('aes-256-ctr', key, iv)

// 通过流式加密进行加密
const encrypted = Buffer.concat([
  cipher.update(plainText, 'utf8'),
  cipher.final(),
])

console.log(encrypted.length)

const offset = 899
const length = 40
const partOfEncrypted = encrypted.subarray(offset, offset + length)

const blockIndex = Math.floor(offset / 16)
const newIv = bufferAdd16Bytes(iv, number2Buffer(blockIndex, 16))

const dummyBufferLen = offset % 16

const newPartOfEncrypted = Buffer.concat([
  Buffer.alloc(dummyBufferLen),
  partOfEncrypted,
])

// 如果你想解密，也可以通过类似的方式
const decipher = crypto.createDecipheriv('aes-256-ctr', key, newIv)
const decryptedPart = Buffer.concat([
  decipher.update(newPartOfEncrypted),
  decipher.final(),
]).subarray(dummyBufferLen)

console.log('Decrypted Part:', decryptedPart.toString('utf8')) // 应该返回对应的明文
