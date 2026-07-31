import assert from "node:assert/strict";
import { test } from "node:test";

import { requestJson } from "../src/http.js";

test("retries transient fetch failures and eventually succeeds", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls < 3) {
      const cause = Object.assign(new Error("other side closed"), {
        code: "UND_ERR_SOCKET"
      });
      throw new TypeError("fetch failed", { cause });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await requestJson<{ ok: boolean }>(
    "https://example.test/data",
    { retries: 2, retryBaseDelayMs: 0 },
    fetchImpl
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
});

test("reports the request and underlying cause after retries are exhausted", async () => {
  const fetchImpl: typeof fetch = async () => {
    const cause = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET"
    });
    throw new TypeError("fetch failed", { cause });
  };

  await assert.rejects(
    requestJson(
      "https://example.test/data",
      { retries: 1, retryBaseDelayMs: 0 },
      fetchImpl
    ),
    /GET https:\/\/example\.test\/data failed after 2 attempts: fetch failed \(ECONNRESET: connection reset\)/
  );
});

test("reports retry timing to the caller", async () => {
  const retries: Array<{
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    reason: string;
  }> = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("busy", {
        status: 429,
        headers: { "Retry-After": "0" }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await requestJson(
    "https://example.test/data",
    {
      retries: 1,
      retryBaseDelayMs: 0,
      onRetry: (info) => retries.push(info)
    },
    fetchImpl
  );

  assert.equal(retries.length, 1);
  assert.equal(retries[0]?.attempt, 1);
  assert.equal(retries[0]?.maxAttempts, 2);
  assert.equal(retries[0]?.delayMs, 0);
  assert.match(retries[0]?.reason ?? "", /HTTP 429/);
});

test("runs the pacing hook before the initial request and every retry", async () => {
  const attempts: number[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls < 3) {
      throw new TypeError("fetch failed");
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await requestJson(
    "https://example.test/data",
    {
      retries: 2,
      retryBaseDelayMs: 0,
      beforeAttempt: ({ attempt }) => {
        attempts.push(attempt);
      }
    },
    fetchImpl
  );

  assert.deepEqual(attempts, [1, 2, 3]);
});
