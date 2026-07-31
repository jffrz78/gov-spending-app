import { parse } from "csv-parse/sync";
import { strFromU8, unzipSync } from "fflate";

import { requestBytes, requestJson } from "./http.js";
import type { LogFunction, PrimeTransaction } from "./types.js";

const CONTRACT_TYPE_CODES = ["A", "B", "C", "D"];
const DOWNLOAD_COLUMNS = [
  "recipient_name",
  "recipient_parent_name",
  "federal_action_obligation",
  "potential_total_value_of_award",
  "modification_number",
  "action_date"
];

interface DownloadJob {
  status_url?: string;
  file_name?: string;
  file_url?: string;
}

interface DownloadStatus {
  status?: "failed" | "finished" | "ready" | "running";
  message?: string | null;
  file_name?: string;
  file_url?: string;
  total_rows?: number | null;
}

interface DownloadCsvRow {
  [column: string]: string | undefined;
}

export interface PrimeTransactionDownload {
  transactions: PrimeTransaction[];
  statusPolls: number;
  requestCount: number;
}

export interface UsaSpendingClientOptions {
  downloadPollIntervalMs?: number;
  downloadTimeoutMs?: number;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nonempty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function absoluteUrl(value: string, baseUrl: string): string {
  return new URL(value, `${baseUrl}/`).toString();
}

function parseTransactionArchive(archive: Uint8Array): PrimeTransaction[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`USAspending returned an unreadable ZIP archive: ${reason}`);
  }

  const csvFiles = Object.entries(files).filter(([name]) =>
    name.toLowerCase().endsWith(".csv")
  );
  if (csvFiles.length === 0) {
    throw new Error("USAspending download ZIP contained no CSV file.");
  }

  const transactions: PrimeTransaction[] = [];
  for (const [name, bytes] of csvFiles) {
    let rows: DownloadCsvRow[];
    try {
      rows = parse(strFromU8(bytes), {
        bom: true,
        columns: true,
        skip_empty_lines: true
      }) as DownloadCsvRow[];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not parse USAspending CSV "${name}": ${reason}`);
    }

    for (const row of rows) {
      transactions.push({
        "Action Date": nonempty(row.action_date),
        "Recipient Name": nonempty(row.recipient_name),
        "Parent Recipient Name": nonempty(row.recipient_parent_name),
        "Transaction Amount": nonempty(row.federal_action_obligation),
        "Maximum Potential Award Amount": nonempty(
          row.potential_total_value_of_award
        ),
        Mod: row.modification_number?.trim() ?? null
      });
    }
  }

  return transactions;
}

export class UsaSpendingClient {
  readonly baseUrl: string;

  constructor(
    baseUrl = "https://api.usaspending.gov",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: LogFunction = console.log,
    private readonly options: UsaSpendingClientOptions = {}
  ) {
    this.baseUrl = trimTrailingSlash(baseUrl);
  }

  async downloadInitialPrimeTransactions(
    date: string
  ): Promise<PrimeTransactionDownload> {
    this.log(
      "USAspending bulk export: submitting one initial-contract-award download job..."
    );
    const job = await requestJson<DownloadJob>(
      `${this.baseUrl}/api/v2/download/search/`,
      {
        method: "POST",
        body: {
          filters: {
            award_type_codes: CONTRACT_TYPE_CODES,
            time_period: [
              {
                start_date: date,
                end_date: date,
                date_type: "new_awards_only"
              }
            ]
          },
          columns: DOWNLOAD_COLUMNS,
          spending_level: ["transactions"],
          file_format: "csv",
          limit: 500_000
        }
      },
      this.fetchImpl
    );

    if (!job.status_url || !job.file_name) {
      throw new Error(
        "USAspending did not return a status URL and filename for the export job."
      );
    }

    const statusUrl = absoluteUrl(job.status_url, this.baseUrl);
    const pollIntervalMs = Math.max(
      0,
      this.options.downloadPollIntervalMs ?? 2_000
    );
    const timeoutMs = Math.max(
      1,
      this.options.downloadTimeoutMs ?? 10 * 60 * 1_000
    );
    const startedAt = Date.now();
    let statusPolls = 0;
    let fileUrl = job.file_url;

    for (;;) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `USAspending export did not finish within ${Math.ceil(timeoutMs / 1_000)} seconds.`
        );
      }
      if (statusPolls > 0 && pollIntervalMs > 0) {
        await wait(pollIntervalMs);
      }

      statusPolls += 1;
      this.log(
        `USAspending bulk export: checking job status ` +
          `(${statusPolls.toLocaleString("en-US")})...`
      );
      const status = await requestJson<DownloadStatus>(
        statusUrl,
        {},
        this.fetchImpl
      );

      if (status.status === "finished") {
        fileUrl = status.file_url ?? fileUrl;
        this.log(
          `USAspending bulk export: ready` +
            `${status.total_rows == null ? "" : ` with ${status.total_rows.toLocaleString("en-US")} rows`}.`
        );
        break;
      }
      if (status.status === "failed") {
        throw new Error(
          `USAspending export failed${status.message ? `: ${status.message}` : "."}`
        );
      }
      if (status.status !== "ready" && status.status !== "running") {
        throw new Error(
          `USAspending returned unknown export status "${String(status.status)}".`
        );
      }
    }

    if (!fileUrl) {
      throw new Error("USAspending export finished without a download URL.");
    }

    this.log("USAspending bulk export: downloading the generated ZIP archive...");
    const archive = await requestBytes(
      absoluteUrl(fileUrl, this.baseUrl),
      {},
      this.fetchImpl
    );
    const transactions = parseTransactionArchive(archive);
    this.log(
      `USAspending bulk export: parsed ${transactions.length.toLocaleString("en-US")} ` +
        "transaction rows from the archive."
    );

    return {
      transactions,
      statusPolls,
      requestCount: statusPolls + 2
    };
  }
}
