import assert from "node:assert/strict";
import { test } from "node:test";

import { strToU8, zipSync } from "fflate";

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

test("uses one bulk export instead of paginated searches or award details", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  let statusChecks = 0;
  const archive = transactionArchive([
    [
      "LOCKHEED MARTIN CORPORATION",
      "LOCKHEED MARTIN CORPORATION",
      "1500000.25",
      "5000000",
      "0",
      "2025-07-28"
    ]
  ]);

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as Record<string, unknown>);
    calls.push({ url, ...(body ? { body } : {}) });

    if (url.endsWith("/api/v2/download/search/")) {
      return jsonResponse({
        status_url: "https://example.test/api/v2/download/status?file_name=test.zip",
        file_name: "test.zip",
        file_url: "https://example.test/downloads/test.zip"
      });
    }
    if (url.includes("/api/v2/download/status")) {
      statusChecks += 1;
      return jsonResponse(
        statusChecks === 1
          ? { status: "running", file_name: "test.zip" }
          : {
              status: "finished",
              file_name: "test.zip",
              file_url: "https://example.test/downloads/test.zip",
              total_rows: 1
            }
      );
    }
    if (url.endsWith("/downloads/test.zip")) {
      return new Response(archive, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const client = new UsaSpendingClient(
    "https://example.test",
    fetchImpl,
    () => undefined,
    { downloadPollIntervalMs: 0 }
  );
  const result = await client.downloadInitialPrimeTransactions("2025-07-28");

  assert.equal(result.statusPolls, 2);
  assert.equal(result.requestCount, 4);
  assert.equal(result.transactions.length, 1);
  assert.deepEqual(result.transactions[0], {
    "Action Date": "2025-07-28",
    "Recipient Name": "LOCKHEED MARTIN CORPORATION",
    "Parent Recipient Name": "LOCKHEED MARTIN CORPORATION",
    "Transaction Amount": "1500000.25",
    "Maximum Potential Award Amount": "5000000",
    Mod: "0"
  });

  const requestBody = calls[0]!.body!;
  assert.deepEqual(requestBody.spending_level, ["transactions"]);
  assert.deepEqual(requestBody.filters, {
    award_type_codes: ["A", "B", "C", "D"],
    time_period: [
      {
        start_date: "2025-07-28",
        end_date: "2025-07-28",
        date_type: "new_awards_only"
      }
    ]
  });
  assert.ok(
    (requestBody.columns as string[]).includes("potential_total_value_of_award")
  );
  assert.ok(
    !(requestBody.columns as string[]).includes("usaspending_permalink")
  );
  assert.equal(
    calls.filter((call) => call.url.includes("spending_by_transaction")).length,
    0
  );
  assert.equal(
    calls.filter((call) => call.url.includes("/api/v2/awards/")).length,
    0
  );
});

test("reports a failed bulk export job", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v2/download/search/")) {
      return jsonResponse({
        status_url: "/api/v2/download/status?file_name=failed.zip",
        file_name: "failed.zip",
        file_url: "/downloads/failed.zip"
      });
    }
    return jsonResponse({
      status: "failed",
      file_name: "failed.zip",
      message: "Export worker unavailable"
    });
  };

  const client = new UsaSpendingClient(
    "https://example.test",
    fetchImpl,
    () => undefined,
    { downloadPollIntervalMs: 0 }
  );

  await assert.rejects(
    client.downloadInitialPrimeTransactions("2025-07-28"),
    /Export worker unavailable/
  );
});
