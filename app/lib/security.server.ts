import { createHash, randomUUID } from "node:crypto";

import { ZodError } from "zod";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
  identifier?: string;
}

type LogLevel = "info" | "warn" | "error";

const rateLimits = new Map<string, RateLimitRecord>();
const sensitiveKeys = /password|secret|token|code|cookie|authorization|cipher|key|salt|iv/i;

function sanitizeString(value: string) {
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[redacted-mongodb-uri]")
    .replace(/\bre_[A-Za-z0-9_-]{10,}\b/g, "[redacted-api-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+\b/gi, "Bearer [redacted]")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[redacted-email]");
}

function clientAddress(request: Request) {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Real-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKeys.test(key) ? "[redacted]" : redact(item, depth + 1),
      ]),
    );
  }
  if (typeof value === "string") {
    const safe = sanitizeString(value);
    return safe.length > 500 ? `${safe.slice(0, 500)}…` : safe;
  }
  return value;
}

export function getRequestId(request: Request) {
  return request.headers.get("X-Request-Id")?.slice(0, 100) || randomUUID();
}

export function logSafe(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {},
) {
  const safeContext = redact(context) as Record<string, unknown>;
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeContext,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export function auditError(request: Request, event: string, error: unknown) {
  logSafe("error", event, {
    requestId: getRequestId(request),
    method: request.method,
    path: new URL(request.url).pathname,
    error,
  });
}

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const hasSession = request.headers.has("Cookie");

  if (
    (origin && origin !== expected) ||
    (!origin && !fetchSite && hasSession) ||
    (!origin && fetchSite && !["same-origin", "none"].includes(fetchSite))
  ) {
    throw new Response("Solicitud cross-site rechazada.", { status: 403 });
  }
}

export function enforceRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  const identity = `${clientAddress(request)}:${options.identifier ?? ""}`;
  const key = `${options.bucket}:${hashIdentifier(identity)}`;
  const current = rateLimits.get(key);
  const record =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;

  record.count += 1;
  rateLimits.set(key, record);

  if (rateLimits.size > 10_000) {
    for (const [entryKey, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(entryKey);
    }
  }

  if (record.count > options.limit) {
    const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    logSafe("warn", "rate_limit_exceeded", {
      bucket: options.bucket,
      requestId: getRequestId(request),
    });
    throw new Response("Demasiadas solicitudes. Intenta más tarde.", {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }
}

export function formatValidationError(error: unknown) {
  return error instanceof ZodError
    ? error.issues[0]?.message ?? "Datos inválidos."
    : "Datos inválidos.";
}
