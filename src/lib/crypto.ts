import { createServerOnlyFn } from '@tanstack/react-start'

// AES-256-GCM at-rest encryption for LinkedIn tokens and BYO AI keys, via the
// Web Crypto API (crypto.subtle). Unlike node:crypto, `crypto` is a real
// global in both Node and the browser - no module import at all, so there's
// nothing for the bundler to choke on client-side, and nothing requiring
// `require`/dynamic import that could be missing in an ESM-only runtime.
// Execution is still server-only in practice: ENCRYPTION_KEY only exists in
// the server's process.env, so this would fail fast (not silently) if ever
// reached client-side. createServerOnlyFn keeps that contract explicit.
const ALGO = 'AES-GCM'

async function keyMaterial(): Promise<CryptoKey> {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not set')
  const bytes = fromBase64(raw)
  if (bytes.byteLength !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes')
  return crypto.subtle.importKey('raw', bytes, ALGO, false, ['encrypt', 'decrypt'])
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// TS's DOM lib types Uint8Array as generic over ArrayBufferLike (which
// includes SharedArrayBuffer), while Web Crypto's BufferSource only accepts
// plain ArrayBuffer - a known mismatch, not a real runtime concern here since
// these are always freshly allocated. Cast at the boundary rather than
// fighting the type across every call site.
function fromBase64(b64: string): BufferSource {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Returns "iv:ciphertext" (both base64). AES-GCM's auth tag is appended to
// the ciphertext by Web Crypto itself, so there's no separate tag to store.
export const encrypt = createServerOnlyFn(async (plaintext: string): Promise<string> => {
  const key = await keyMaterial()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(plaintext))
  return `${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`
})

export const decrypt = createServerOnlyFn(async (payload: string): Promise<string> => {
  const [ivB64, dataB64] = payload.split(':')
  if (!ivB64 || !dataB64) throw new Error('Malformed encrypted payload')
  const key = await keyMaterial()
  const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv: fromBase64(ivB64) }, key, fromBase64(dataB64))
  return new TextDecoder().decode(plaintext)
})
