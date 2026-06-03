export function buildUrl(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/{([^}]+)}/g, (_match, key) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Missing required parameter "${key}" for URL: ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}
