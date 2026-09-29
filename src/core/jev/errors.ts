/**
 * Typed errors. Messages never include request headers or keys.
 */
export class CrosstalkError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class AuthError extends CrosstalkError {
  readonly status = 401;
  constructor(message = "401 Unauthorized: missing or invalid API key") {
    super("auth", message);
  }
}

/** 422. Keeps the response body (shape undocumented, treated as opaque JSON). */
export class ValidationError extends CrosstalkError {
  readonly status = 422;
  readonly body: unknown;
  constructor(body: unknown) {
    super("validation", `422 Unprocessable Entity: ${truncate(safeStringify(body), 500)}`);
    this.body = body;
  }
}

export class RateLimitError extends CrosstalkError {
  readonly status = 429;
  constructor(message = "429 Too Many Requests") {
    super("rate_limit", message);
  }
}

export class OverloadedError extends CrosstalkError {
  readonly status = 529;
  constructor(message = "529 Overloaded") {
    super("overloaded", message);
  }
}

export class HttpError extends CrosstalkError {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super("http", `HTTP ${status}: ${truncate(safeStringify(body), 300)}`);
    this.status = status;
    this.body = body;
  }
}

export class ConnectionError extends CrosstalkError {
  constructor(message: string) {
    super("connection", message);
  }
}

export class TimeoutError extends CrosstalkError {
  constructor(ms: number) {
    super("timeout", `request timed out after ${ms} ms`);
  }
}

export class AbortedError extends CrosstalkError {
  constructor() {
    super("aborted", "request aborted");
  }
}

/** The response did not match the documented wire format. */
export class SchemaError extends CrosstalkError {
  constructor(message: string) {
    super("schema", message);
  }
}

/** A request that the API would reject, caught before sending. */
export class RequestError extends CrosstalkError {
  constructor(message: string) {
    super("request", message);
  }
}

export class BudgetExceeded extends CrosstalkError {
  constructor(message: string) {
    super("budget", message);
  }
}

export class UnsupportedInMock extends CrosstalkError {
  constructor(type: string) {
    super("unsupported_in_mock", `the lexical mock supports Choice only, not ${type}`);
  }
}

export class ReplayMiss extends CrosstalkError {
  readonly requestHash: string;
  constructor(requestHash: string) {
    super("replay_miss", `no cached response for request ${requestHash.slice(0, 12)}…`);
    this.requestHash = requestHash;
  }
}

export class SealError extends CrosstalkError {
  constructor(message: string) {
    super("seal", message);
  }
}

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Remove any occurrence of secret values from a string (defense in depth for logs). */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[REDACTED]");
  }
  return out.replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]");
}
