import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { strToU8, zipSync } from "fflate";

import { PublicCompanyMatcher } from "../src/matcher.js";
import { runPoll } from "../src/pipeline.js";
import type { SecCompany } from "../src/types.js";
import { UsaSpendingClient } from "../src/usaspending.js";

const HEADERS = [
  "recipient_name",
  "recipient_parent_name",
  "federal_action_obligation",
  "potential_total_value_of_award",
  "modification_number",
  "action_date"
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

function transactionArchive(rows: string[][]): Uint8Array {
  const csv = [
    HEADERS.join(","),
    ...rows.map((row) => row.map(csvCell).join(","))
  ].join("\n");
  return zipSync({ "Contracts_PrimeTransactions.csv": strToU8(csv) });
}

function bulkFetch(
  rows: string[][],
  calls: string[]
): typeof fetch {
  const archive = transactionArchive(rows);
  return async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/v2/download/search/")) {
      return jsonResponse({
        status_url: "/api/v2/download/status?file_name=test.zip",
        file_name: "test.zip",
        file_url: "/downloads/test.zip"
      });
    }
    if (url.includes("/api/v2/download/status")) {
      return jsonResponse({
        status: "finished",
        file_name: "test.zip",
        file_url: "/downloads/test.zip",
        total_rows: rows.length
      });
    }
    if (url.endsWith("/downloads/test.zip")) {
      return new Response(archive, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

const companies: SecCompany[] = [
  {
    cik: 200,
    name: "LOCKHEED MARTIN CORP",
    tickers: ["LMT"],
    exchanges: ["NYSE"]
  },
  {
    cik: 300,
    name: "LEIDOS HOLDINGS INC",
    tickers: ["LDOS"],
    exchanges: ["NYSE"]
  }
];

test("filters a bulk export, matches recipients and parents, and writes Markdown", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const rows = [
    [
      "LOCKHEED MARTIN CORPORATION",
      "LOCKHEED MARTIN CORPORATION",
      "1500000.25",
      "5000000",
      "0",
      "2026-07-29"
    ],
    [
      "LOCKHEED MARTIN CORPORATION",
      "LOCKHEED MARTIN CORPORATION",
      "499999.75",
      "1000000",
      "0",
      "2026-07-29"
    ],
    [
      "ACME FEDERAL, LLC",
      "LEIDOS HOLDINGS, INC.",
      "250000",
      "900000",
      "0",
      "2026-07-29"
    ],
    [
      "LOCKHEED MARTIN CORPORATION",
      "",
      "500",
      "5000",
      "P00001",
      "2026-07-29"
    ],
    [
      "LOCKHEED MARTIN CORPORATION",
      "",
      "1",
      "1",
      "0",
      "2026-07-28"
    ],
    [
      "PRIVATE COMPANY LLC",
      "",
      "100",
      "100",
      "0",
      "2026-07-29"
    ]
  ];

  const directory = await mkdtemp(join(tmpdir(), "gov-spend-test-"));
  const outputPath = join(directory, "gov_spend.md");
  const summary = await runPoll({
    date: "2026-07-29",
    outputPath,
    usaSpending: new UsaSpendingClient(
      "https://example.test",
      bulkFetch(rows, calls),
      (message) => logs.push(message),
      { downloadPollIntervalMs: 0 }
    ),
    matcher: new PublicCompanyMatcher(companies, { aliases: [] }),
    log: (message) => logs.push(message)
  });

  assert.equal(summary.primeTransactionsScanned, 6);
  assert.equal(summary.initialAwardsFound, 4);
  assert.equal(summary.matchedInitialAwards, 3);
  assert.equal(summary.entries.length, 2);
  assert.equal(summary.usaSpendingRequestCount, 3);
  assert.equal(calls.length, 3);
  assert.equal(
    calls.filter((call) => call.includes("spending_by_transaction")).length,
    0
  );
  assert.equal(
    calls.filter((call) => call.includes("/api/v2/awards/")).length,
    0
  );

  const markdown = await readFile(outputPath, "utf8");
  assert.match(markdown, /LOCKHEED MARTIN CORPORATION/);
  assert.match(markdown, /ACME FEDERAL, LLC/);
  assert.match(markdown, /\$2,000,000\.00/);
  assert.match(markdown, /\$6,000,000\.00/);
  assert.match(markdown, /\| LMT \|/);
  assert.match(markdown, /\| LDOS \|/);
  assert.doesNotMatch(markdown, /LEIDOS HOLDINGS INC/);
  assert.doesNotMatch(markdown, /Public issuer|Entry type|Reference/);
  assert.doesNotMatch(markdown, /PRIVATE COMPANY LLC/);
  assert.ok(
    logs.some((message) => message.includes("one USAspending bulk export"))
  );
  assert.ok(
    logs.some((message) => message.includes("Markdown output saved successfully"))
  );
  assert.ok(logs.some((message) => message.includes("2 ticker rows")));
});

test("a busy date still uses only one export, one status check, and one download", async () => {
  const totalRows = 18_500;
  const publicRows = 26;
  const calls: string[] = [];
  const rows = Array.from({ length: totalRows }, (_, index) => [
    index < publicRows
      ? "LOCKHEED MARTIN CORPORATION"
      : "PRIVATE COMPANY LLC",
    "",
    "100",
    "500",
    "0",
    "2025-07-28"
  ]);
  const directory = await mkdtemp(join(tmpdir(), "gov-spend-busy-test-"));

  const summary = await runPoll({
    date: "2025-07-28",
    outputPath: join(directory, "gov_spend.md"),
    usaSpending: new UsaSpendingClient(
      "https://example.test",
      bulkFetch(rows, calls),
      () => undefined,
      { downloadPollIntervalMs: 0 }
    ),
    matcher: new PublicCompanyMatcher(companies, { aliases: [] }),
    log: () => undefined
  });

  assert.equal(summary.primeTransactionsScanned, totalRows);
  assert.equal(summary.matchedInitialAwards, publicRows);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0]?.ticker, "LMT");
  assert.equal(summary.entries[0]?.committedAmount, 2600);
  assert.equal(summary.entries[0]?.maximumPotentialAmount, 13000);
  assert.equal(summary.usaSpendingRequestCount, 3);
  assert.equal(calls.length, 3);
});
