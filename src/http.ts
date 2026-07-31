export interface JsonRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  retryJitterRatio?: number;
  timeoutMs?: number;
  beforeAttempt?: (info: HttpAttemptInfo) => void | Promise<void>;
  onRetry?: (info: HttpRetryInfo) => void;
}

export interface HttpAttemptInfo {
  attempt: number;
  maxAttempts: number;
}

export interface HttpRetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorDescription(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause;
  if (!cause || typeof cause !== "object") {
    return error.message;
  }

  const causeCode =
    "code" in cause && typeof cause.code === "string" ? cause.code : null;
  const causeMessage =
    "message" in cause && typeof cause.message === "string"
      ? cause.message
      : null;
  const detail = [causeCode, causeMessage].filter(Boolean).join(": ");
  return detail ? `${error.message} (${detail})` : error.message;
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function requestData<T>(
  url: string,
  options: JsonRequestOptions,
  fetchImpl: typeof fetch,
  readResponse: (response: Response) => Promise<T>
): Promise<T> {
  const retries = options.retries ?? 5;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 750;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 15_000;
  const retryJitterRatio = options.retryJitterRatio ?? 0;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const method = options.method ?? "GET";
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let serverDelayMs: number | null = null;
    try {
      await options.beforeAttempt?.({
        attempt: attempt + 1,
        maxAttempts: retries + 1
      });
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...options.headers
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 2_000);
        const error = new HttpError(
          `${method} ${url} returned HTTP ${response.status}.`,
          response.status,
          responseBody
        );

        if (!retryableStatus(response.status) || attempt === retries) {
          throw error;
        }

        lastError = error;
        serverDelayMs = retryAfterMilliseconds(response);
      } else {
        return await readResponse(response);
      }
    } catch (error) {
      lastError = error;
      const isHttpError = error instanceof HttpError;
      if ((isHttpError && !retryableStatus(error.status)) || attempt === retries) {
        if (isHttpError) {
          throw error;
        }
        throw new Error(
          `${method} ${url} failed after ${attempt + 1} attempts: ` +
            errorDescription(error),
          { cause: error }
        );
      }
    }

    const cappedExponentialDelay = Math.min(
      retryBaseDelayMs * 2 ** attempt,
      retryMaxDelayMs
    );
    const jitterRange = cappedExponentialDelay * retryJitterRatio;
    const jitteredDelay = Math.max(
      0,
      Math.round(
        cappedExponentialDelay +
          (jitterRange > 0 ? (Math.random() * 2 - 1) * jitterRange : 0)
      )
    );
    const delayMs = Math.max(jitteredDelay, serverDelayMs ?? 0);
    options.onRetry?.({
      attempt: attempt + 1,
      maxAttempts: retries + 1,
      delayMs,
      reason: errorDescription(lastError)
    });
    await wait(delayMs);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("HTTP request failed for an unknown reason.");
}

export function requestJson<T>(
  url: string,
  options: JsonRequestOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  return requestData(
    url,
    options,
    fetchImpl,
    async (response) => (await response.json()) as T
  );
}

export function requestBytes(
  url: string,
  options: JsonRequestOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<Uint8Array> {
  return requestData(
    url,
    options,
    fetchImpl,
    async (response) => new Uint8Array(await response.arrayBuffer())
  );
}
