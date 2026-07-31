import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeCompanyName,
  PublicCompanyMatcher
} from "../src/matcher.js";
import { parseSecCompanies } from "../src/sec.js";

const payload = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [100, "ALPHABET INC.", "GOOG", "Nasdaq"],
    [100, "ALPHABET INC.", "GOOGL", "Nasdaq"],
    [200, "LOCKHEED MARTIN CORP", "LMT", "NYSE"],
    [300, "OTC EXAMPLE INC", "OTCX", "OTC"]
  ]
};

test("normalizes legal suffixes without losing meaningful words", () => {
  assert.equal(
    normalizeCompanyName("The Lockheed Martin Corporation"),
    "LOCKHEED MARTIN"
  );
  assert.equal(normalizeCompanyName("BANK OF AMERICA CORP /DE/"), "BANK OF AMERICA");
});

test("filters exchanges and groups multiple ticker classes", () => {
  const companies = parseSecCompanies(payload);
  assert.equal(companies.length, 2);
  assert.deepEqual(companies[0]?.tickers, ["GOOG", "GOOGL"]);
  assert.equal(companies.some((company) => company.tickers.includes("OTCX")), false);
});

test("matches exact names, conservative divisions, and configured aliases", () => {
  const matcher = new PublicCompanyMatcher(parseSecCompanies(payload), {
    aliases: [
      {
        recipientNames: ["Skunk Works Federal Programs, LLC"],
        ticker: "LMT"
      }
    ]
  });

  assert.deepEqual(
    matcher.match("ALPHABET INC.")?.issuer.tickers,
    ["GOOG", "GOOGL"]
  );
  assert.equal(
    matcher.match("LOCKHEED MARTIN AERONAUTICS")?.issuer.tickers[0],
    "LMT"
  );
  assert.equal(
    matcher.match("Skunk Works Federal Programs, LLC")?.method,
    "configured-alias"
  );
  assert.equal(matcher.match("LOCKHEED COUNTY SERVICES"), null);
});
