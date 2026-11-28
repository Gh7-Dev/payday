import nacl from 'tweetnacl';

export function createWallet(): nacl.SignKeyPair {
  return nacl.sign.keyPair();
}

// encryptKey: PBKDF2-SHA256 600k iterations, AES-GCM.
// Blob layout: salt(16) + iv(12) + ciphertext(80) = 108 bytes -> ~144 base64 chars.
export async function encryptKey(secretKey64: Uint8Array, secretText: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secretText), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, secretKey64.buffer.slice(secretKey64.byteOffset, secretKey64.byteOffset + secretKey64.byteLength) as BufferSource));
  const blob = new Uint8Array(16 + 12 + ciphertext.length);
  blob.set(salt, 0);
  blob.set(iv, 16);
  blob.set(ciphertext, 28);
  const b64 = btoa(String.fromCharCode(...blob));
  if (b64.length > 2048) throw new Error('blob_too_large');
  return b64;
}

// decryptKey: reverses encryptKey. Throws 'wrong_pin' if decryption fails.
export async function decryptKey(blob: string, secretText: string): Promise<Uint8Array> {
  const raw = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ciphertext = raw.slice(28);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secretText), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
    return new Uint8Array(plain);
  } catch {
    throw new Error('wrong_pin');
  }
}

// Local cache: stores only non-secret identity fields.
export interface CachedIdentity {
  walletPublicKey?: string;
  role?: 'organizer' | 'trainer' | 'trainee';
  eventId?: string;
  linkCode?: string;
  /** trainee phone or trainer username */
  contact?: string;
}

const CACHE_KEY = 'payday_identity';

export function loadCache(): CachedIdentity {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedIdentity) : {};
  } catch {
    return {};
  }
}

export function saveCache(data: CachedIdentity): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable; ignore
  }
}

export function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
