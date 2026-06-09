/**
 * In-memory per-IP sliding-window rate limiter.
 *
 * Production note: on Vercel with multiple serverless instances, the
 * in-memory Map does NOT share state across instances — the effective
 * limit is `LIMIT × N_instances`. For production, replace with
 * `@upstash/ratelimit` backed by Upstash Redis (or equivalent).
 */

export const DEFAULT_LIMIT = 10;
export const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  ip: string,
  action: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS,
): { allowed: boolean; retryAfterMs: number } {
  const key = `${action}:${ip}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  const existing = buckets.get(key);
  const recent =
    existing?.filter((ts) => ts > cutoff) ?? [];

  if (recent.length >= limit) {
    const oldest = recent[0]!;
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    buckets.set(key, recent);
    return { allowed: false, retryAfterMs };
  }

  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true, retryAfterMs: 0 };
}

export function getClientIpFromHeaders(headersList: Headers): string {
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headersList.get("x-real-ip");
  if (real) {
    const trimmed = real.trim();
    if (trimmed) return trimmed;
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[rate-limit] Could not determine client IP (no x-forwarded-for / x-real-ip). Falling back to 'unknown'.",
    );
  }
  return "unknown";
}
