export interface CacheKeyOptions {
  hashLength?: number;
  isNormalizeObject?: boolean;
}

const EMPTY_HASH = '0';

function isEmpty(val: unknown): boolean {
  if (val == null) return true;
  if (typeof val === 'object') {
    if (Array.isArray(val)) return val.length === 0;
    return Object.keys(val as Record<string, unknown>).length === 0;
  }
  return false;
}

export function generateCacheKey(
  apiKey: string,
  params: unknown,
  data: unknown,
  options: CacheKeyOptions = {}
): string {
  const { hashLength = 32, isNormalizeObject = false } = options;

  const paramsHash = isEmpty(params)
    ? EMPTY_HASH
    : hashString(JSON.stringify(isNormalizeObject ? normalizeObject(params) : stableNormalize(params)), hashLength);

  const dataHash = isEmpty(data)
    ? EMPTY_HASH
    : hashString(JSON.stringify(isNormalizeObject ? normalizeObject(data) : stableNormalize(data)), hashLength);

  return `${apiKey}:${paramsHash}:${dataHash}`;
}

export function stableNormalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stableNormalize);
  }

  const sortedObj: Record<string, unknown> = {};
  Object.keys(obj as Record<string, unknown>)
    .sort()
    .forEach(key => {
      sortedObj[key] = stableNormalize((obj as Record<string, unknown>)[key]);
    });

  return sortedObj;
}

export function normalizeObject(obj: unknown, seen = new WeakSet<object>()): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (seen.has(obj as object)) {
    return '__CIRCULAR_REF__';
  }
  seen.add(obj as object);

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (obj instanceof RegExp) {
    return obj.toString();
  }

  if (obj instanceof Map) {
    return Array.from(obj.entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
    );
  }

  if (obj instanceof Set) {
    return Array.from(obj.values()).sort();
  }

  if (ArrayBuffer.isView(obj)) {
    return Array.from(new Uint8Array(obj.buffer));
  }

  if (Array.isArray(obj)) {
    return obj.map(item => normalizeObject(item, seen));
  }

  const sortedObj: Record<string, unknown> = {};
  Object.keys(obj as Record<string, unknown>)
    .sort()
    .forEach(key => {
      const value = (obj as Record<string, unknown>)[key];

      if (value === undefined) {
        sortedObj[key] = '__undefined__';
      } else if (typeof value === 'number' && isNaN(value)) {
        sortedObj[key] = '__NaN__';
      } else if (value === Infinity) {
        sortedObj[key] = '__Infinity__';
      } else if (value === -Infinity) {
        sortedObj[key] = '__-Infinity__';
      } else if (value instanceof Error) {
        sortedObj[key] = `Error: ${value.message}`;
      } else {
        sortedObj[key] = normalizeObject(value, seen);
      }
    });

  return sortedObj;
}

export function hashString(str: string, bitLength: number = 32): string {
  if (str.length === 0) {
    return '0'.repeat(bitLength / 4);
  }

  return bitLength === 64 ? fnv1a64(str) : fnv1a32(str);
}

function fnv1a32(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fnv1a64(str: string): string {
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash *= prime;
  }
  return hash.toString(16).padStart(16, '0');
}
