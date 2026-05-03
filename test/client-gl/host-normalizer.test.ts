import { describe, it, expect } from 'vitest';
import { normalizeHost } from '@client-webgl/network/host-normalizer.js';

describe('normalizeHost', () => {
  describe('errors', () => {
    it('rejects empty input', () => {
      expect(normalizeHost('')).toEqual({ error: 'host is empty' });
      expect(normalizeHost('   ')).toEqual({ error: 'host is empty' });
    });

    it('rejects whitespace-containing input', () => {
      const r = normalizeHost('host with spaces');
      expect(r).toHaveProperty('error');
    });

    it('rejects syntactically invalid input', () => {
      // URL parser rejects plain `://`; this is a representative bad-syntax case.
      const r = normalizeHost('://broken');
      expect(r).toHaveProperty('error');
    });
  });

  describe('bare hostnames default to wss', () => {
    it('plain domain → wss://host/ws', () => {
      expect(normalizeHost('companions.example.com'))
        .toEqual({ url: 'wss://companions.example.com/ws' });
    });

    it('domain with port → wss://host:port/ws', () => {
      expect(normalizeHost('companions.example.com:8443'))
        .toEqual({ url: 'wss://companions.example.com:8443/ws' });
    });

    it('public IP → wss', () => {
      expect(normalizeHost('192.168.1.5:3001'))
        .toEqual({ url: 'wss://192.168.1.5:3001/ws' });
    });
  });

  describe('local hostnames default to ws', () => {
    it('localhost → ws://localhost/ws', () => {
      expect(normalizeHost('localhost'))
        .toEqual({ url: 'ws://localhost/ws' });
    });

    it('localhost with port → ws://localhost:port/ws', () => {
      expect(normalizeHost('localhost:3001'))
        .toEqual({ url: 'ws://localhost:3001/ws' });
    });

    it('127.0.0.1 → ws', () => {
      expect(normalizeHost('127.0.0.1:3001'))
        .toEqual({ url: 'ws://127.0.0.1:3001/ws' });
    });

    it('*.local → ws', () => {
      expect(normalizeHost('myhost.local'))
        .toEqual({ url: 'ws://myhost.local/ws' });
    });
  });

  describe('explicit scheme is preserved', () => {
    it('https → wss', () => {
      expect(normalizeHost('https://example.com'))
        .toEqual({ url: 'wss://example.com/ws' });
    });

    it('http → ws (insecure choice respected)', () => {
      expect(normalizeHost('http://example.com'))
        .toEqual({ url: 'ws://example.com/ws' });
    });

    it('wss preserved', () => {
      expect(normalizeHost('wss://example.com'))
        .toEqual({ url: 'wss://example.com/ws' });
    });

    it('ws preserved', () => {
      expect(normalizeHost('ws://example.com'))
        .toEqual({ url: 'ws://example.com/ws' });
    });

    it('explicit ws on a public host stays insecure', () => {
      // User opts into insecure even on a non-local host.
      expect(normalizeHost('ws://example.com:8080'))
        .toEqual({ url: 'ws://example.com:8080/ws' });
    });
  });

  describe('explicit paths are preserved literally', () => {
    it('keeps a non-/ws path verbatim', () => {
      expect(normalizeHost('wss://example.com/api/socket'))
        .toEqual({ url: 'wss://example.com/api/socket' });
    });

    it('treats / alone as no path → /ws', () => {
      expect(normalizeHost('wss://example.com/'))
        .toEqual({ url: 'wss://example.com/ws' });
    });

    it('preserves path with port', () => {
      expect(normalizeHost('wss://example.com:8443/v2/ws'))
        .toEqual({ url: 'wss://example.com:8443/v2/ws' });
    });
  });
});
