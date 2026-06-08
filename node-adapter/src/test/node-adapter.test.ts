import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Import from the source directly for testing
import { createNodeAdapter } from '../adapter';
import { SimpleCookieJar } from '../cookie-jar';
import { resolveProxy, matchesNoProxy } from '../proxy';
import { buildRedirectUrl, methodAfterRedirect, shouldKeepBody } from '../redirect';
import { calcBodySize } from '../utils/body-size';

// === Utilities Tests ===

describe('buildRedirectUrl', () => {
  it('resolves absolute URL', () => {
    expect(buildRedirectUrl('https://other.example.com/path', 'https://example.com/original'))
      .toBe('https://other.example.com/path');
  });

  it('resolves protocol-relative URL', () => {
    expect(buildRedirectUrl('//other.example.com/path', 'https://example.com/original'))
      .toBe('https://other.example.com/path');
  });

  it('resolves origin-relative URL', () => {
    expect(buildRedirectUrl('/new-path', 'https://example.com/old'))
      .toBe('https://example.com/new-path');
  });

  it('resolves path-relative URL', () => {
    expect(buildRedirectUrl('../new', 'https://example.com/dir/page'))
      .toBe('https://example.com/new');
  });
});

describe('methodAfterRedirect', () => {
  it('303 always GET', () => {
    expect(methodAfterRedirect('POST', 303)).toBe('GET');
  });

  it('301/302 HEAD preserved', () => {
    expect(methodAfterRedirect('HEAD', 301)).toBe('HEAD');
    expect(methodAfterRedirect('HEAD', 302)).toBe('HEAD');
  });

  it('301/302 POST → GET', () => {
    expect(methodAfterRedirect('POST', 301)).toBe('GET');
    expect(methodAfterRedirect('POST', 302)).toBe('GET');
  });

  it('307/308 preserve method', () => {
    expect(methodAfterRedirect('POST', 307)).toBe('POST');
    expect(methodAfterRedirect('POST', 308)).toBe('POST');
    expect(methodAfterRedirect('DELETE', 308)).toBe('DELETE');
  });
});

describe('shouldKeepBody', () => {
  it('303 drops body', () => expect(shouldKeepBody('POST', 303)).toBe(false));
  it('301/302 drop body', () => {
    expect(shouldKeepBody('POST', 301)).toBe(false);
    expect(shouldKeepBody('POST', 302)).toBe(false);
  });
  it('307/308 keep body', () => {
    expect(shouldKeepBody('POST', 307)).toBe(true);
    expect(shouldKeepBody('PUT', 308)).toBe(true);
  });
});

describe('matchesNoProxy', () => {
  it('matches exact hostname', () => {
    expect(matchesNoProxy('example.com', 'example.com')).toBe(true);
  });

  it('matches wildcard', () => {
    expect(matchesNoProxy('example.com', '*')).toBe(true);
  });

  it('matches .domain suffix', () => {
    expect(matchesNoProxy('sub.example.com', '.example.com')).toBe(true);
  });

  it('matches *.domain suffix', () => {
    expect(matchesNoProxy('sub.example.com', '*.example.com')).toBe(true);
  });

  it('does not match different domain', () => {
    expect(matchesNoProxy('example.com', 'other.com')).toBe(false);
  });

  it('handles multiple rules', () => {
    expect(matchesNoProxy('internal.corp.com', 'localhost, .corp.com, 127.0.0.1')).toBe(true);
  });
});

describe('calcBodySize', () => {
  it('calculates string size', () => {
    expect(calcBodySize('hello')).toBe(5);
  });

  it('calculates Buffer size', () => {
    expect(calcBodySize(Buffer.from('hello'))).toBe(5);
  });

  it('calculates Uint8Array size', () => {
    expect(calcBodySize(new Uint8Array([1, 2, 3]))).toBe(3);
  });

  it('returns 0 for unknown types', () => {
    expect(calcBodySize({})).toBe(0);
    expect(calcBodySize(null)).toBe(0);
  });
});

// === Cookie Jar Tests ===

describe('SimpleCookieJar', () => {
  it('returns empty string when no cookies', () => {
    const jar = new SimpleCookieJar();
    expect(jar.getCookieString('https://example.com')).toBe('');
  });

  it('stores and retrieves cookies', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com', {
      'set-cookie': 'session=abc123; Path=/',
    });
    expect(jar.getCookieString('https://example.com')).toBe('session=abc123');
  });

  it('handles multiple cookies', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com', {
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
    });
    expect(jar.getCookieString('https://example.com')).toContain('a=1');
    expect(jar.getCookieString('https://example.com')).toContain('b=2');
  });

  it('respects path matching', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com/admin', {
      'set-cookie': 'token=admin123; Path=/admin',
    });
    expect(jar.getCookieString('https://example.com/admin/users')).toContain('token=admin123');
    expect(jar.getCookieString('https://example.com/public')).toBe('');
  });

  it('respects domain matching', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com', {
      'set-cookie': 'token=val; Domain=example.com; Path=/',
    });
    expect(jar.getCookieString('https://example.com')).toContain('token=val');
    expect(jar.getCookieString('https://sub.example.com')).toContain('token=val');
    expect(jar.getCookieString('https://other.com')).toBe('');
  });

  it('respects secure flag', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com', {
      'set-cookie': 'token=val; Path=/; Secure',
    });
    expect(jar.getCookieString('http://example.com')).toBe('');
    expect(jar.getCookieString('https://example.com')).toContain('token=val');
  });

  it('expires cookies', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com', {
      'set-cookie': 'token=val; Path=/; Max-Age=0',
    });
    expect(jar.getCookieString('https://example.com')).toBe('');
  });

  it('clears all cookies', () => {
    const jar = new SimpleCookieJar();
    jar.setCookieFromHeaders('https://example.com', {
      'set-cookie': 'a=1; Path=/',
    });
    jar.clear();
    expect(jar.getCookieString('https://example.com')).toBe('');
  });
});

// === Adapter Integration Tests ===

describe('createNodeAdapter', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (url.pathname === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'hello' }));
      } else if (url.pathname === '/text') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('plain text response');
      } else if (url.pathname === '/echo') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ method: req.method, body: body || null, headers: req.headers }));
        });
      } else if (url.pathname === '/redirect/permanent') {
        res.writeHead(301, { Location: '/json' });
        res.end();
      } else if (url.pathname === '/redirect/temporary') {
        res.writeHead(302, { Location: '/json' });
        res.end();
      } else if (url.pathname === '/redirect/loop') {
        res.writeHead(302, { Location: '/redirect/loop' });
        res.end();
      } else if (url.pathname === '/status/404') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      } else if (url.pathname === '/status/500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('server error');
      } else if (url.pathname === '/timeout') {
        // Simulate slow response
        setTimeout(() => {
          res.writeHead(200);
          res.end('slow');
        }, 5000);
      } else if (url.pathname === '/set-cookie') {
        res.writeHead(200, { 'Set-Cookie': ['session=abc; Path=/', 'theme=dark; Path=/'] });
        res.end(JSON.stringify({ ok: true }));
      } else if (url.pathname === '/headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ host: req.headers.host, cookie: req.headers.cookie || null }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });

    await new Promise<void>(resolve => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('sends GET request and parses JSON', async () => {
    const adapter = createNodeAdapter();
    const res = await adapter.request({ url: `${baseUrl}/json`, method: 'GET', headers: {} });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'hello' });
  });

  it('returns text response', async () => {
    const adapter = createNodeAdapter();
    const res = await adapter.request({
      url: `${baseUrl}/text`, method: 'GET', headers: {}, responseType: 'text',
    });
    expect(res.data).toBe('plain text response');
  });

  it('sends POST with JSON body', async () => {
    const adapter = createNodeAdapter();
    const res = await adapter.request({
      url: `${baseUrl}/echo`, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('method', 'POST');
    expect((res.data as { body: string }).body).toContain('test');
  });

  it('follows 301 redirect', async () => {
    const adapter = createNodeAdapter({ maxRedirects: 5 });
    const res = await adapter.request({ url: `${baseUrl}/redirect/permanent`, method: 'GET', headers: {} });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'hello' });
  });

  it('follows 302 redirect', async () => {
    const adapter = createNodeAdapter({ maxRedirects: 5 });
    const res = await adapter.request({ url: `${baseUrl}/redirect/temporary`, method: 'GET', headers: {} });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'hello' });
  });

  it('rejects on redirect loop', async () => {
    const adapter = createNodeAdapter({ maxRedirects: 2 });
    await expect(
      adapter.request({ url: `${baseUrl}/redirect/loop`, method: 'GET', headers: {} }),
    ).rejects.toThrow('Exceeded max redirects');
  });

  it('respects maxRedirects: 0', async () => {
    const adapter = createNodeAdapter({ maxRedirects: 0 });
    const res = await adapter.request({ url: `${baseUrl}/redirect/temporary`, method: 'GET', headers: {} });
    expect(res.status).toBe(302);
  });

  it('returns 4xx status (does not throw — validation is api-service concern)', async () => {
    const adapter = createNodeAdapter();
    const res = await adapter.request({ url: `${baseUrl}/status/404`, method: 'GET', headers: {} });
    expect(res.status).toBe(404);
  });

  it('returns 5xx status', async () => {
    const adapter = createNodeAdapter();
    const res = await adapter.request({ url: `${baseUrl}/status/500`, method: 'GET', headers: {} });
    expect(res.status).toBe(500);
  });

  it('times out on slow response', async () => {
    const adapter = createNodeAdapter();
    await expect(
      adapter.request({ url: `${baseUrl}/timeout`, method: 'GET', headers: {}, timeout: 100 }),
    ).rejects.toThrow('timed out');
  });

  it('cancels via AbortSignal', async () => {
    const adapter = createNodeAdapter();
    const controller = new AbortController();
    const promise = adapter.request({ url: `${baseUrl}/timeout`, method: 'GET', headers: {}, signal: controller.signal });
    // Abort immediately
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  it('handles stream response', async () => {
    const adapter = createNodeAdapter();
    const res = await adapter.request({
      url: `${baseUrl}/json`, method: 'GET', headers: {}, responseType: 'stream',
    });
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
    // Data is a Readable stream
    expect(typeof (res.data as NodeJS.ReadableStream).pipe).toBe('function');
    // Consume the stream
    const chunks: Buffer[] = [];
    for await (const chunk of res.data as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    expect(result).toEqual({ message: 'hello' });
  });

  it('integrates with cookie jar', async () => {
    const jar = new SimpleCookieJar();
    const adapter = createNodeAdapter({ cookieJar: jar });

    // First request sets cookies
    await adapter.request({ url: `${baseUrl}/set-cookie`, method: 'GET', headers: {} });

    // Second request should send cookies
    const res = await adapter.request({ url: `${baseUrl}/headers`, method: 'GET', headers: {} });
    const cookieHeader = (res.data as { cookie: string | null }).cookie;

    expect(cookieHeader).toBeTruthy();
    expect(cookieHeader).toContain('session=abc');
    expect(cookieHeader).toContain('theme=dark');
  });
});
