export interface LimiterOptions {
  maxFails?: number;
  lockMs?: number;
  clock?: () => number;
}

interface KeyState {
  failures: number;
  lockedUntil: number;
}

export class Limiter {
  private maxFails: number;
  private lockMs: number;
  private clock: () => number;
  private states: Map<string, KeyState> = new Map();

  constructor(options?: LimiterOptions) {
    this.maxFails = options?.maxFails ?? 5;
    this.lockMs = options?.lockMs ?? 15 * 60 * 1000; // 15 minutes default
    this.clock = options?.clock ?? (() => Date.now());
  }

  private isKeyLocked(key: string, now: number): boolean {
    const state = this.states.get(key);
    if (!state) return false;
    if (state.lockedUntil > now) {
      return true;
    }
    // Lock expired: reset failure count
    if (state.lockedUntil > 0) {
      state.failures = 0;
      state.lockedUntil = 0;
    }
    return false;
  }

  private registerFail(key: string, now: number) {
    let state = this.states.get(key);
    if (!state) {
      state = { failures: 0, lockedUntil: 0 };
      this.states.set(key, state);
    }

    if (state.lockedUntil > 0 && state.lockedUntil <= now) {
      state.failures = 0;
      state.lockedUntil = 0;
    }

    state.failures++;
    if (state.failures >= this.maxFails) {
      state.lockedUntil = now + this.lockMs;
    }
  }

  private clearKey(key: string) {
    this.states.delete(key);
  }

  /**
   * guard.check(ip, phone) is blocked (returns false / blocked: true)
   * if either key 'ip:<ip>' or 'phone:<phone>' is locked.
   * Returns true if blocked, false if allowed.
   */
  check(ip: string, phone: string): boolean {
    const now = this.clock();
    const ipKey = `ip:${ip}`;
    const phoneKey = `phone:${phone}`;
    return this.isKeyLocked(ipKey, now) || this.isKeyLocked(phoneKey, now);
  }

  /**
   * guard.fail(ip, phone) counts a failure on both keys.
   * A key locks after MAX_FAILS failures for LOCK_MS.
   */
  fail(ip: string, phone: string) {
    const now = this.clock();
    this.registerFail(`ip:${ip}`, now);
    this.registerFail(`phone:${phone}`, now);
  }

  /**
   * guard.success(ip, phone) clears both keys.
   */
  success(ip: string, phone: string) {
    this.clearKey(`ip:${ip}`);
    this.clearKey(`phone:${phone}`);
  }
}
