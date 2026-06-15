type CacheEntry<T> = { value: T; mtimeMs: number };

const stores = new Map<string, Map<string, CacheEntry<unknown>>>();

function bucket(name: string): Map<string, CacheEntry<unknown>> {
  let b = stores.get(name);
  if (!b) {
    b = new Map();
    stores.set(name, b);
  }
  return b;
}

export function getCache<T>(name: string, key: string, mtimeMs: number): T | undefined {
  const b = bucket(name);
  const entry = b.get(key);
  if (!entry) return undefined;
  if (entry.mtimeMs !== mtimeMs) {
    b.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCache<T>(name: string, key: string, mtimeMs: number, value: T): void {
  bucket(name).set(key, { value, mtimeMs });
}

export function invalidateAll(): void {
  for (const b of stores.values()) b.clear();
}

export function invalidate(name: string, key?: string): void {
  if (!key) {
    stores.get(name)?.clear();
    return;
  }
  stores.get(name)?.delete(key);
}
