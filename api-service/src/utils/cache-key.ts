function isEmpty(val: unknown): boolean {
  if (val == null) return true;
  if (typeof val === 'object') {
    if (Array.isArray(val)) return val.length === 0;
    return Object.keys(val as Record<string, unknown>).length === 0;
  }
  return false;
}

export function stableNormalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stableNormalize);
  }
  const sorted: Record<string, unknown> = {};
  Object.keys(obj as Record<string, unknown>)
    .sort()
    .forEach(key => {
      sorted[key] = stableNormalize((obj as Record<string, unknown>)[key]);
    });
  return sorted;
}

export function hashString(str: string, bitLength: number = 32): string {
  if (str.length === 0) return '0'.repeat(bitLength / 4);
  return bitLength === 64 ? fnv1a64(str) : fnv1a32(str);
}

export function generateCacheKey(
  apiKey: string,
  params: unknown,
  data: unknown,
): string {
  const EMPTY = '0';
  const paramsHash = isEmpty(params)
    ? EMPTY
    : hashString(JSON.stringify(stableNormalize(params)));
  const dataHash = isEmpty(data)
    ? EMPTY
    : hashString(JSON.stringify(stableNormalize(data)));
  return `${apiKey}:${paramsHash}:${dataHash}`;
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
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1);
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
