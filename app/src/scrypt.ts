import { scrypt, randomBytes, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';

function scryptPromise(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

export class HashBusyError extends Error {
  constructor(message = 'Hash queue busy') {
    super(message);
    this.name = 'HashBusyError';
  }
}

// Queue / concurrency limiter for scrypt operations
class HashLimiter {
  private active = 0;
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(
    private concurrency: number = 2,
    private waitMs: number = 10000
  ) {}

  updateConfig(concurrency: number, waitMs: number) {
    this.concurrency = concurrency;
    this.waitMs = waitMs;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.concurrency) {
      this.active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new HashBusyError());
      }, this.waitMs);

      this.queue.push({
        resolve: () => {
          clearTimeout(timer);
          resolve(() => {
            this.release();
          });
        },
        reject,
        timer,
      });
    });
  }

  private release() {
    this.active--;
    if (this.queue.length > 0 && this.active < this.concurrency) {
      this.active++;
      const next = this.queue.shift();
      if (next) {
        next.resolve();
      }
    }
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export const hashLimiter = new HashLimiter(
  Number(process.env.HASH_CONCURRENCY) || 2,
  Number(process.env.HASH_WAIT_MS) || 10000
);

export function getScryptN(): number {
  if (process.env.SCRYPT_N) {
    const val = Number(process.env.SCRYPT_N);
    if (!isNaN(val) && val > 0) return val;
  }
  return 131072; // 2^17
}

export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEY_LEN = 32;
export const SALT_LEN = 16;

export type ScryptRunner = (
  secret: string,
  salt: Buffer,
  keyLen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

let customScryptRunner: ScryptRunner | null = null;

export function setCustomScryptRunner(runner: ScryptRunner | null) {
  customScryptRunner = runner;
}

async function runScrypt(
  secret: string,
  salt: Buffer,
  keyLen: number,
  N: number,
  r: number,
  p: number
): Promise<Buffer> {
  const release = await hashLimiter.acquire();
  try {
    const maxmem = Math.max(256 * 1024 * 1024, 128 * N * r * 2);
    if (customScryptRunner) {
      return await customScryptRunner(secret, salt, keyLen, { N, r, p, maxmem });
    }
    const derived = await scryptPromise(secret, salt, keyLen, { N, r, p, maxmem });
    return derived as Buffer;
  } finally {
    release();
  }
}

/**
 * Hashes a secret using scrypt.
 * Returns formatted string: 'scrypt$N$r$p$saltB64$hashB64'
 */
export async function hashSecret(secret: string): Promise<string> {
  const N = getScryptN();
  const r = SCRYPT_R;
  const p = SCRYPT_P;
  const salt = randomBytes(SALT_LEN);

  const derived = await runScrypt(secret, salt, KEY_LEN, N, r, p);

  const saltB64 = salt.toString('base64');
  const hashB64 = derived.toString('base64');

  return `scrypt$${N}$${r}$${p}$${saltB64}$${hashB64}`;
}

/**
 * Verifies a secret against a stored scrypt hash string.
 * Format: 'scrypt$N$r$p$saltB64$hashB64'
 * Returns true if valid, false on wrong secret or malformed stored string (never throws).
 */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  try {
    if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) {
      return false;
    }

    const parts = stored.split('$');
    if (parts.length !== 6) {
      return false;
    }

    const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
    const N = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);

    if (isNaN(N) || isNaN(r) || isNaN(p) || N <= 1 || r < 1 || p < 1) {
      return false;
    }

    const salt = Buffer.from(saltB64, 'base64');
    const expectedHash = Buffer.from(hashB64, 'base64');

    if (salt.length === 0 || expectedHash.length === 0) {
      return false;
    }

    const derived = await runScrypt(secret, salt, expectedHash.length, N, r, p);

    if (derived.length !== expectedHash.length) {
      return false;
    }

    return timingSafeEqual(derived, expectedHash);
  } catch {
    return false;
  }
}
