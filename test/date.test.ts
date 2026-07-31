import assert from "node:assert/strict";
import { test } from "node:test";

import { assertIsoDate, previousCalendarDate } from "../src/date.js";

test("calculates the prior New York calendar day across UTC boundaries", () => {
  assert.equal(
    previousCalendarDate(
      new Date("2026-07-30T02:00:00.000Z"),
      "America/New_York"
    ),
    "2026-07-28"
  );
});

test("calculates the prior day across a year boundary", () => {
  assert.equal(
    previousCalendarDate(
      new Date("2026-01-01T17:00:00.000Z"),
      "America/New_York"
    ),
    "2025-12-31"
  );
});

test("rejects malformed and impossible dates", () => {
  assert.throws(() => assertIsoDate("07/29/2026"), /Expected YYYY-MM-DD/);
  assert.throws(() => assertIsoDate("2026-02-30"), /Invalid calendar date/);
});
