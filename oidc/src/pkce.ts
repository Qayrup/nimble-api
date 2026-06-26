import type { PkcePair } from './types';

function base64UrlEncode(buf: Uint8Array): string {
  const str = String.fromCharCode(...buf);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(verifier: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hash);
}

export async function generatePkcePair(): Promise<PkcePair> {
  const arr = new Uint8Array(128);
  crypto.getRandomValues(arr);
  const codeVerifier = base64UrlEncode(arr);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  return { codeVerifier, codeChallenge };
}

export async function createPkcePair(verifier: string): Promise<PkcePair> {
  return {
    codeVerifier: verifier,
    codeChallenge: base64UrlEncode(await sha256(verifier)),
  };
}
