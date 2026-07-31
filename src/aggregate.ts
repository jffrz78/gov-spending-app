import type { MatchedAward, OutputEntry } from "./types.js";

interface MutableTickerEntry {
  date: string;
  recipientNames: Set<string>;
  committedAmount: number;
  committedValues: number;
  maximumPotentialAmount: number;
  maximumPotentialValues: number;
  ticker: string;
}

export function aggregateAwardsByTicker(
  awards: MatchedAward[]
): OutputEntry[] {
  const byTicker = new Map<string, MutableTickerEntry>();

  for (const award of awards) {
    const uniqueTickers = new Set(
      award.tickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean)
    );

    for (const ticker of uniqueTickers) {
      let entry = byTicker.get(ticker);
      if (!entry) {
        entry = {
          date: award.date,
          recipientNames: new Set<string>(),
          committedAmount: 0,
          committedValues: 0,
          maximumPotentialAmount: 0,
          maximumPotentialValues: 0,
          ticker
        };
        byTicker.set(ticker, entry);
      }

      entry.recipientNames.add(award.recipientName);
      if (award.committedAmount !== null) {
        entry.committedAmount += award.committedAmount;
        entry.committedValues += 1;
      }
      if (award.maximumPotentialAmount !== null) {
        entry.maximumPotentialAmount += award.maximumPotentialAmount;
        entry.maximumPotentialValues += 1;
      }
    }
  }

  return [...byTicker.values()]
    .map((entry) => ({
      date: entry.date,
      recipientNames: [...entry.recipientNames].sort((left, right) =>
        left.localeCompare(right)
      ),
      committedAmount:
        entry.committedValues === 0 ? null : entry.committedAmount,
      maximumPotentialAmount:
        entry.maximumPotentialValues === 0
          ? null
          : entry.maximumPotentialAmount,
      ticker: entry.ticker
    }))
    .sort((left, right) => {
      if (left.committedAmount === null && right.committedAmount !== null) {
        return 1;
      }
      if (left.committedAmount !== null && right.committedAmount === null) {
        return -1;
      }

      const amountDifference =
        (right.committedAmount ?? 0) - (left.committedAmount ?? 0);
      return amountDifference !== 0
        ? amountDifference
        : left.ticker.localeCompare(right.ticker);
    });
}
