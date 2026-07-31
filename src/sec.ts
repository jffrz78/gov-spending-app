import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { requestJson } from "./http.js";
import type { LogFunction, SecCompany } from "./types.js";

interface SecExchangePayload {
  fields: string[];
  data: unknown[][];
}

export const DEFAULT_SEC_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";
export const DEFAULT_ALLOWED_EXCHANGES = [
  "Nasdaq",
  "NYSE",
  "NYSE American"
] as const;

function isFresh(modifiedAtMs: number, ttlMs: number): boolean {
  return Date.now() - modifiedAtMs <= ttlMs;
}

async function readPayload(path: string): Promise<SecExchangePayload> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as SecExchangePayload;
}

async function cachedPayload(
  path: string,
  ttlMs: number
): Promise<SecExchangePayload | null> {
  try {
    const metadata = await stat(path);
    if (!isFresh(metadata.mtimeMs, ttlMs)) {
      return null;
    }
    return await readPayload(path);
  } catch {
    return null;
  }
}

export async function loadSecExchangePayload(options: {
  cachePath: string;
  secUrl?: string;
  userAgent: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  log?: LogFunction;
}): Promise<SecExchangePayload> {
  const log = options.log ?? console.log;
  const ttlMs = options.cacheTtlMs ?? 24 * 60 * 60 * 1_000;
  const cached = await cachedPayload(options.cachePath, ttlMs);
  if (cached) {
    log(`Using fresh SEC exchange-data cache at ${options.cachePath}.`);
    return cached;
  }

  log("SEC exchange-data cache is missing or stale; downloading current data...");
  try {
    const payload = await requestJson<SecExchangePayload>(
      options.secUrl ?? DEFAULT_SEC_URL,
      {
        headers: { "User-Agent": options.userAgent }
      },
      options.fetchImpl ?? fetch
    );
    validateSecPayload(payload);
    await mkdir(dirname(options.cachePath), { recursive: true });
    await writeFile(options.cachePath, JSON.stringify(payload), "utf8");
    log(`Downloaded SEC exchange data and refreshed ${options.cachePath}.`);
    return payload;
  } catch (error) {
    try {
      const stale = await readPayload(options.cachePath);
      validateSecPayload(stale);
      const reason = error instanceof Error ? error.message : String(error);
      log(`SEC download failed (${reason}); using the stale cache instead.`);
      return stale;
    } catch {
      throw error;
    }
  }
}

export function validateSecPayload(
  payload: SecExchangePayload
): asserts payload is SecExchangePayload {
  if (
    !payload ||
    !Array.isArray(payload.fields) ||
    !Array.isArray(payload.data)
  ) {
    throw new Error("SEC ticker response did not have the expected fields/data format.");
  }

  for (const required of ["cik", "name", "ticker", "exchange"]) {
    if (!payload.fields.includes(required)) {
      throw new Error(`SEC ticker response is missing the "${required}" field.`);
    }
  }
}

export function parseSecCompanies(
  payload: SecExchangePayload,
  allowedExchanges: readonly string[] = DEFAULT_ALLOWED_EXCHANGES
): SecCompany[] {
  validateSecPayload(payload);
  const indexes = Object.fromEntries(
    payload.fields.map((field, index) => [field, index])
  ) as Record<string, number>;
  const allowed = new Set(allowedExchanges.map((value) => value.toUpperCase()));
  const grouped = new Map<string, SecCompany>();

  for (const row of payload.data) {
    const cik = Number(row[indexes.cik!]);
    const name = String(row[indexes.name!] ?? "").trim();
    const ticker = String(row[indexes.ticker!] ?? "").trim().toUpperCase();
    const exchange = String(row[indexes.exchange!] ?? "").trim();

    if (
      !Number.isFinite(cik) ||
      !name ||
      !ticker ||
      !allowed.has(exchange.toUpperCase())
    ) {
      continue;
    }

    const key = `${cik}:${name.toUpperCase()}`;
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.tickers.includes(ticker)) {
        existing.tickers.push(ticker);
      }
      if (!existing.exchanges.includes(exchange)) {
        existing.exchanges.push(exchange);
      }
    } else {
      grouped.set(key, {
        cik,
        name,
        tickers: [ticker],
        exchanges: [exchange]
      });
    }
  }

  return [...grouped.values()].map((company) => ({
    ...company,
    tickers: company.tickers.sort(),
    exchanges: company.exchanges.sort()
  }));
}
