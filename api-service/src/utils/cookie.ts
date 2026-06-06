export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
