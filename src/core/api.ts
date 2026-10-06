/** Thin fetch wrapper for the Hanzi Rush backend (shared/api.ts is the contract). */
import { Capacitor } from '@capacitor/core';
import { API_PREFIX, AUTH_HEADER, LIMITS, authValue, type ApiErrorBody, type DeviceInfo, type ErrorCode, type Platform } from '../../shared/api';

/** the production deploy; the native shell has no same-origin server to fall back to */
const NATIVE_DEFAULT = 'https://hanzi-rush.zeze.app';
const RAW = (import.meta.env.VITE_API_BASE ?? '').trim() || (Capacitor.isNativePlatform() ? NATIVE_DEFAULT : '');
/** `VITE_API_BASE=off` disables every cloud feature */
export const API_OFF = RAW === 'off';
/** '' = same-origin (the web default) */
const BASE = (API_OFF ? '' : RAW.replace(/\/$/, '')) + API_PREFIX;

export const DEVICE: DeviceInfo = { platform: Capacitor.getPlatform() as Platform, appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0' };

/** `status 0` + code 'offline' = the request never produced a usable answer (network, timeout, wrong content) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'offline',
    readonly body: ApiErrorBody | null = null,
    message?: string,
  ) {
    super(message ?? body?.error.message ?? code);
  }
  get retryAfter(): number | undefined {
    return this.body?.error.retryAfter;
  }
  /** worth retrying later without changing the request */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface ApiOpts {
  body?: unknown;
  token?: string | null;
  keepalive?: boolean;
  /** per-call override of LIMITS.timeoutMs (the save endpoints get longer: a big doc on a slow link) */
  timeoutMs?: number;
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, opts: ApiOpts = {}): Promise<T> {
  if (API_OFF) throw new ApiError(0, 'offline');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) headers[AUTH_HEADER] = authValue(opts.token);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? LIMITS.timeoutMs);
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body, signal: ctl.signal, keepalive: opts.keepalive && body !== undefined });
  } catch {
    throw new ApiError(0, 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const eb = json && typeof json === 'object' && typeof json.error?.code === 'string' ? (json as ApiErrorBody) : null;
    // 5xx is the server being unwell; anything else without our error body (HTML 404 from a dev server
    // with no API, a captive portal…) means there is no API to talk to
    if (!eb) throw res.status >= 500 ? new ApiError(res.status, 'server_error') : new ApiError(0, 'offline');
    if (res.status === 429 && eb.error.retryAfter === undefined) {
      const n = Number(res.headers.get('Retry-After'));
      if (n > 0) eb.error.retryAfter = n;
    }
    throw new ApiError(res.status, eb.error.code, eb);
  }
  // a 2xx that isn't our JSON (SPA fallback returning index.html) means there is no API behind this origin
  if (json === null) throw new ApiError(0, 'offline');
  return json as T;
}
