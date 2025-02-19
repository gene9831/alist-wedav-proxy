import { create } from 'flat-cache'

const cache = create({
  ttl: 60 * 60 * 1000, // 1 hour
  lruSize: 1000, // 1,000 items
  expirationInterval: 5 * 1000 * 60, // 5 minutes
  persistInterval: 5 * 1000 * 60, // 5 minutes
  cacheId: 'test',
  cacheDir: './cache',
})

console.log(cache.getKey('key'))

cache.setKey('key', new Date())
