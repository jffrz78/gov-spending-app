export type LogFunction = (message: string) => void;

export interface PrimeTransaction {
  "Action Date": string | null;
  "Recipient Name": string | null;
  "Parent Recipient Name"?: string | null;
  "Transaction Amount": string | number | null;
  "Maximum Potential Award Amount"?: string | number | null;
  Mod: string | null;
}

export interface SecCompany {
  cik: number;
  name: string;
  tickers: string[];
  exchanges: string[];
}

export interface CompanyAliasFile {
  aliases: Array<{
    recipientNames: string[];
    ticker: string;
  }>;
}

export interface CompanyMatch {
  issuer: SecCompany;
  matchedName: string;
  method: "recipient-name" | "parent-name" | "configured-alias";
}

export interface MatchedAward {
  date: string;
  recipientName: string;
  committedAmount: number | null;
  maximumPotentialAmount: number | null;
  tickers: string[];
}

export interface OutputEntry {
  date: string;
  recipientNames: string[];
  committedAmount: number | null;
  maximumPotentialAmount: number | null;
  ticker: string;
}

export interface RunSummary {
  date: string;
  primeTransactionsScanned: number;
  initialAwardsFound: number;
  matchedInitialAwards: number;
  exportStatusPolls: number;
  usaSpendingRequestCount: number;
  entries: OutputEntry[];
  outputPath: string;
}
