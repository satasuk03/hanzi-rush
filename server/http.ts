import { STATUS, type ApiErrorBody, type ErrorCode } from '../shared/api';

export interface ApiErrorOpts {
  retryAfter?: number;
  reason?: string;
  /** extra top-level body fields (e.g. `current` on 409) */
  body?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public opts: ApiErrorOpts = {},
  ) {
    super(message);
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export function fail(code: ErrorCode, message: string, opts?: ApiErrorOpts): never {
  throw new ApiError(code, message, opts);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(e: ApiError): Response {
  const error: ApiErrorBody['error'] = { code: e.code, message: e.message };
  if (e.opts.retryAfter !== undefined) error.retryAfter = e.opts.retryAfter;
  if (e.opts.reason !== undefined) error.reason = e.opts.reason;
  const headers: Record<string, string> = {};
  if (e.opts.retryAfter !== undefined) headers['Retry-After'] = String(Math.max(1, Math.ceil(e.opts.retryAfter)));
  return json({ ...e.opts.body, error }, e.status, headers);
}

/** Reads a JSON body with a hard byte cap (Content-Length first, then the actual bytes). */
export async function readJson(req: Request, maxBytes: number): Promise<{ value: unknown; bytes: number }> {
  const cl = req.headers.get('Content-Length');
  if (cl !== null && Number(cl) > maxBytes) fail('payload_too_large', 'Request body too large');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) fail('payload_too_large', 'Request body too large');
  try {
    return { value: JSON.parse(new TextDecoder().decode(buf)), bytes: buf.byteLength };
  } catch {
    return fail('bad_request', 'Malformed JSON');
  }
}

export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

type Handler = () => Promise<Response> | Response;

/** Per-method dispatch with a 405 for everything else. */
export function byMethod(req: Request, handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>): Promise<Response> | Response {
  const h = handlers[req.method as 'GET'];
  if (!h) return fail('method_not_allowed', 'Method not allowed');
  return h();
}
