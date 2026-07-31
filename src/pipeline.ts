import { aggregateAwardsByTicker } from "./aggregate.js";
import { writeGovSpendMarkdown } from "./markdown.js";
import { PublicCompanyMatcher } from "./matcher.js";
import { UsaSpendingClient } from "./usaspending.js";
import type {
  LogFunction,
  MatchedAward,
  PrimeTransaction,
  RunSummary
} from "./types.js";

export interface PollOptions {
  date: string;
  outputPath: string;
  usaSpending: UsaSpendingClient;
  matcher: PublicCompanyMatcher;
  log?: LogFunction;
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isInitialAward(transaction: PrimeTransaction): boolean {
  if (transaction.Mod === null) {
    return false;
  }
  const mod = transaction.Mod.trim();
  return mod === "" || /^0+$/.test(mod);
}

function primeEntry(
  transaction: PrimeTransaction,
  matcher: PublicCompanyMatcher
): MatchedAward | null {
  const recipient = transaction["Recipient Name"]?.trim();
  const date = transaction["Action Date"];
  if (!recipient || !date) {
    return null;
  }

  const match = matcher.match(
    recipient,
    transaction["Parent Recipient Name"]
  );
  if (!match) {
    return null;
  }

  return {
    date,
    recipientName: recipient,
    committedAmount: numberOrNull(transaction["Transaction Amount"]),
    maximumPotentialAmount: numberOrNull(
      transaction["Maximum Potential Award Amount"]
    ),
    tickers: match.issuer.tickers
  };
}

export async function runPoll(options: PollOptions): Promise<RunSummary> {
  const log = options.log ?? console.log;
  log(
    "Requesting one USAspending bulk export for initial prime contract awards; " +
      "paginated searches and per-award detail requests are not used."
  );
  const download =
    await options.usaSpending.downloadInitialPrimeTransactions(options.date);
  const rawPrimeActions = download.transactions;

  const primeActions = rawPrimeActions.filter(
    (action) =>
      action["Action Date"] === options.date &&
      isInitialAward(action)
  );
  log(
    `Initial-award validation retained ${primeActions.length.toLocaleString("en-US")}/` +
      `${rawPrimeActions.length.toLocaleString("en-US")} exported transactions; ` +
      "unexpected dates or modification rows were excluded locally."
  );

  log(
    "Matching recipients and exported parent recipients to SEC-listed issuers..."
  );
  const matchedAwards: MatchedAward[] = [];
  for (const transaction of primeActions) {
    const entry = primeEntry(transaction, options.matcher);
    if (entry) {
      matchedAwards.push(entry);
    }
  }

  const matchedInitialAwards = matchedAwards.length;
  log(
    `Matched ${matchedInitialAwards.toLocaleString("en-US")} initial prime ` +
      "contract awards to public issuers."
  );
  const entries = aggregateAwardsByTicker(matchedAwards);
  log(
    `Grouped those awards into ${entries.length.toLocaleString("en-US")} ` +
      `ticker ${entries.length === 1 ? "row" : "rows"}.`
  );
  log(
    `Writing ${entries.length.toLocaleString("en-US")} ticker ` +
      `${entries.length === 1 ? "row" : "rows"} to ${options.outputPath}...`
  );
  await writeGovSpendMarkdown(options.outputPath, options.date, entries);
  log("Markdown output saved successfully.");

  return {
    date: options.date,
    primeTransactionsScanned: rawPrimeActions.length,
    initialAwardsFound: primeActions.length,
    matchedInitialAwards,
    exportStatusPolls: download.statusPolls,
    usaSpendingRequestCount: download.requestCount,
    entries,
    outputPath: options.outputPath
  };
}
