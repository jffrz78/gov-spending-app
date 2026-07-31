#!/usr/bin/env node

import { resolve } from "node:path";

import { assertIsoDate, previousCalendarDate } from "./date.js";
import { loadCompanyAliases, PublicCompanyMatcher } from "./matcher.js";
import { runPoll } from "./pipeline.js";
import {
  DEFAULT_SEC_URL,
  loadSecExchangePayload,
  parseSecCompanies
} from "./sec.js";
import { UsaSpendingClient } from "./usaspending.js";

interface CliOptions {
  date?: string;
  timeZone: string;
  outputPath: string;
  aliasPath: string;
  secCachePath: string;
  secUrl: string;
  usaSpendingBaseUrl: string;
  pollIntervalMs: number;
  downloadTimeoutMs: number;
}

const HELP = `gov-spend-poller

Usage:
  npm run poll
  npm run poll -- --date 2026-07-29 --output gov_spend.md

Options:
  --date YYYY-MM-DD       Action date to retrieve (default: previous day)
  --timezone IANA_NAME    Time zone for calculating "previous day"
                          (default: America/New_York)
  --output PATH           Markdown output (default: ./gov_spend.md)
  --aliases PATH          Company alias JSON (default: config/company_aliases.json)
  --sec-cache PATH        SEC exchange-data cache (default: .cache/sec-exchanges.json)
  --sec-url URL           Override SEC ticker/exchange endpoint
  --api-base-url URL      Override USAspending API base URL
  --poll-interval-ms N    Delay between bulk-export status checks
                          (default: 2000)
  --download-timeout-ms N Maximum time to wait for the bulk export
                          (default: 600000)
  --help                  Show this help
`;

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function requirePositiveInteger(
  args: string[],
  index: number,
  flag: string
): number {
  const value = requireValue(args, index, flag);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function requireNonnegativeInteger(
  args: string[],
  index: number,
  flag: string
): number {
  const value = requireValue(args, index, flag);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a nonnegative integer.`);
  }
  return parsed;
}

export function parseCli(args: string[]): CliOptions {
  const options: CliOptions = {
    timeZone: "America/New_York",
    outputPath: resolve("gov_spend.md"),
    aliasPath: resolve("config/company_aliases.json"),
    secCachePath: resolve(".cache/sec-exchanges.json"),
    secUrl: process.env.SEC_TICKER_URL ?? DEFAULT_SEC_URL,
    usaSpendingBaseUrl:
      process.env.USASPENDING_API_BASE_URL ?? "https://api.usaspending.gov",
    pollIntervalMs: 2_000,
    downloadTimeoutMs: 10 * 60 * 1_000
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    switch (flag) {
      case "--date":
        options.date = requireValue(args, index, flag);
        index += 1;
        break;
      case "--timezone":
        options.timeZone = requireValue(args, index, flag);
        index += 1;
        break;
      case "--output":
        options.outputPath = resolve(requireValue(args, index, flag));
        index += 1;
        break;
      case "--aliases":
        options.aliasPath = resolve(requireValue(args, index, flag));
        index += 1;
        break;
      case "--sec-cache":
        options.secCachePath = resolve(requireValue(args, index, flag));
        index += 1;
        break;
      case "--sec-url":
        options.secUrl = requireValue(args, index, flag);
        index += 1;
        break;
      case "--api-base-url":
        options.usaSpendingBaseUrl = requireValue(args, index, flag);
        index += 1;
        break;
      case "--poll-interval-ms":
        options.pollIntervalMs = requireNonnegativeInteger(args, index, flag);
        index += 1;
        break;
      case "--download-timeout-ms":
        options.downloadTimeoutMs = requirePositiveInteger(args, index, flag);
        index += 1;
        break;
      case "--help":
        process.stdout.write(HELP);
        process.exit(0);
      default:
        throw new Error(`Unknown argument "${flag}".\n\n${HELP}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const date = assertIsoDate(
    options.date ?? previousCalendarDate(new Date(), options.timeZone)
  );
  const log = (message: string): void => {
    console.log(`[gov-spend] ${message}`);
  };

  log(`Starting poll for USAspending action date ${date}.`);
  log(`Markdown output: ${options.outputPath}`);
  log(
    "Initial-awards-only mode: USAspending filters for new awards on the " +
      "server; modifications and subcontracts are excluded."
  );
  log(
    "Bulk-export mode: one export job replaces paginated transaction searches " +
      "and per-award detail requests."
  );
  log(
    `Export status checks are spaced by ${options.pollIntervalMs}ms with a ` +
      `${options.downloadTimeoutMs}ms overall timeout.`
  );
  log("Loading SEC-listed companies and configured recipient aliases...");

  const [secPayload, aliasFile] = await Promise.all([
    loadSecExchangePayload({
      cachePath: options.secCachePath,
      secUrl: options.secUrl,
      userAgent:
        process.env.SEC_USER_AGENT ??
        "GovSpendPoller/1.0 local-contract-research",
      log
    }),
    loadCompanyAliases(options.aliasPath)
  ]);
  const companies = parseSecCompanies(secPayload);
  if (companies.length === 0) {
    throw new Error("SEC data contained no companies on the allowed exchanges.");
  }
  log(
    `Loaded ${companies.length.toLocaleString("en-US")} public issuers and ` +
      `${aliasFile.aliases.length.toLocaleString("en-US")} configured aliases.`
  );

  const summary = await runPoll({
    date,
    outputPath: options.outputPath,
    usaSpending: new UsaSpendingClient(
      options.usaSpendingBaseUrl,
      fetch,
      log,
      {
        downloadPollIntervalMs: options.pollIntervalMs,
        downloadTimeoutMs: options.downloadTimeoutMs
      }
    ),
    matcher: new PublicCompanyMatcher(companies, aliasFile),
    log
  });

  log(
    `Complete: wrote ${summary.entries.length.toLocaleString("en-US")} ticker ` +
      `${summary.entries.length === 1 ? "row" : "rows"} for ${summary.date} ` +
      `to ${summary.outputPath}.`
  );
  log(
    `Initial prime awards: ${summary.matchedInitialAwards.toLocaleString("en-US")}/` +
      `${summary.initialAwardsFound.toLocaleString("en-US")} matched a public issuer ` +
      `after scanning ${summary.primeTransactionsScanned.toLocaleString("en-US")} transactions.`
  );
  log(
    `USAspending bulk-export requests: ${summary.usaSpendingRequestCount.toLocaleString("en-US")} ` +
      `(one job submission, ${summary.exportStatusPolls.toLocaleString("en-US")} ` +
      `${summary.exportStatusPolls === 1 ? "status check" : "status checks"}, one archive download; retries excluded).`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[gov-spend] Failed: ${message}`);
  process.exitCode = 1;
});
