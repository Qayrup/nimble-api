import { describe, it, expect } from 'vitest';
import { generatePkcePair, createPkcePair } from '../pkce';

describe('PKCE', () => {
  describe('generatePkcePair()', () => {
    it('generates a 128-byte random code_verifier (base64url)', async () => {
      const pair = await generatePkcePair();
      // base64 of 128 bytes ~ 172 chars, minus padding
      expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(150);
      // must be base64url (no +, /, or =)
      expect(pair.codeVerifier).not.toMatch(/[+\/=]/);
      // challenge is SHA-256 of verifier, base64url
      expect(pair.codeChallenge.length).toBe(43); // SHA-256 = 32 bytes → 43 base64url chars
      expect(pair.codeChallenge).not.toMatch(/[+\/=]/);
      expect(pair.codeChallenge).not.toBe(pair.codeVerifier);
    });

    it('produces different results each call', async () => {
      const a = await generatePkcePair();
      const b = await generatePkcePair();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.codeChallenge).not.toBe(b.codeChallenge);
    });
  });

  describe('createPkcePair()', () => {
    it('computes challenge from a known verifier', async () => {
      const pair = await createPkcePair('test-verifier');
      expect(pair.codeVerifier).toBe('test-verifier');
      expect(pair.codeChallenge).toBeTruthy();
      expect(pair.codeChallenge).not.toBe('test-verifier');
      expect(pair.codeChallenge).not.toMatch(/[+\/=]/);
    });
  });
});
