import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateAwardsByTicker } from "../src/aggregate.js";
import type { MatchedAward } from "../src/types.js";

test("groups awards by ticker and sums reported dollar values", () => {
  const awards: MatchedAward[] = [
    {
      date: "2026-07-29",
      recipientName: "EXAMPLE DEFENSE LLC",
      committedAmount: 125,
      maximumPotentialAmount: 1000,
      tickers: ["EXM", "EXM"]
    },
    {
      date: "2026-07-29",
      recipientName: "EXAMPLE DEFENSE LLC",
      committedAmount: 75,
      maximumPotentialAmount: null,
      tickers: ["EXM"]
    },
    {
      date: "2026-07-29",
      recipientName: "EXAMPLE FEDERAL INC",
      committedAmount: null,
      maximumPotentialAmount: 500,
      tickers: ["EXM"]
    },
    {
      date: "2026-07-29",
      recipientName: "ANOTHER COMPANY",
      committedAmount: null,
      maximumPotentialAmount: null,
      tickers: ["ZZZ"]
    },
    {
      date: "2026-07-29",
      recipientName: "BIG COMPANY",
      committedAmount: 300,
      maximumPotentialAmount: 700,
      tickers: ["BIG"]
    }
  ];

  assert.deepEqual(aggregateAwardsByTicker(awards), [
    {
      date: "2026-07-29",
      recipientNames: ["BIG COMPANY"],
      committedAmount: 300,
      maximumPotentialAmount: 700,
      ticker: "BIG"
    },
    {
      date: "2026-07-29",
      recipientNames: ["EXAMPLE DEFENSE LLC", "EXAMPLE FEDERAL INC"],
      committedAmount: 200,
      maximumPotentialAmount: 1500,
      ticker: "EXM"
    },
    {
      date: "2026-07-29",
      recipientNames: ["ANOTHER COMPANY"],
      committedAmount: null,
      maximumPotentialAmount: null,
      ticker: "ZZZ"
    }
  ]);
});

test("sorts equal committed amounts by ticker and places missing amounts last", () => {
  const awards: MatchedAward[] = [
    {
      date: "2026-07-29",
      recipientName: "Z COMPANY",
      committedAmount: 100,
      maximumPotentialAmount: 200,
      tickers: ["ZZZ"]
    },
    {
      date: "2026-07-29",
      recipientName: "A COMPANY",
      committedAmount: 100,
      maximumPotentialAmount: 200,
      tickers: ["AAA"]
    },
    {
      date: "2026-07-29",
      recipientName: "M COMPANY",
      committedAmount: null,
      maximumPotentialAmount: 200,
      tickers: ["MMM"]
    }
  ];

  assert.deepEqual(
    aggregateAwardsByTicker(awards).map((entry) => entry.ticker),
    ["AAA", "ZZZ", "MMM"]
  );
});
