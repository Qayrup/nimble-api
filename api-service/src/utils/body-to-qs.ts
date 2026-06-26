export function bodyToQueryString(body: unknown): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v != null) {
      sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }
  return sp.toString();
}
