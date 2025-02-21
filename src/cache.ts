import { create, type FlatCacheOptions } from 'flat-cache'

export function createCache<T>(options?: FlatCacheOptions) {
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
    cacheDir: cacheDir || '.cache',
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
