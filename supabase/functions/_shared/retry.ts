// Generic exponential-backoff retry wrapper for edge-function network
// calls (courier API, Resend, RSS/arXiv/HN fetches). The retried function
// decides what counts as a failure by throwing -- this helper just re-runs
// it with a growing delay and gives up after `retries` extra attempts,
// re-throwing whatever the last attempt threw so callers keep their
// existing error handling/logging unchanged.

export type RetryOptions = {
  /** Extra attempts after the first try. Default 2 (3 attempts total). */
  retries?: number;
  /** Delay before the first retry, doubling each attempt after that. */
  baseDelayMs?: number;
  /** Upper bound on the backoff delay regardless of attempt count. */
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      options.onRetry?.(attempt + 1, error, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
