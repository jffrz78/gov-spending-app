import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeDateSection, renderDateSection } from "../src/markdown.js";
import type { OutputEntry } from "../src/types.js";

const entry: OutputEntry = {
  date: "2026-07-29",
  recipientNames: ["EXAMPLE | DEFENSE", "EXAMPLE FEDERAL"],
  committedAmount: 2000,
  maximumPotentialAmount: 12000,
  ticker: "EXM"
};

test("renders one ticker row without removed columns or reference links", () => {
  const section = renderDateSection("2026-07-29", [entry]);
  assert.match(section, /EXAMPLE \\\| DEFENSE<br>EXAMPLE FEDERAL/);
  assert.match(section, /\$2,000\.00/);
  assert.match(section, /\$12,000\.00/);
  assert.match(section, /initial award's USAspending action date/);
  assert.doesNotMatch(
    section,
    /Entry type|Public issuer|Reference|USAspending\]\(/
  );
});

test("sorts rendered rows by legally committed amount descending", () => {
  const section = renderDateSection("2026-07-29", [
    entry,
    {
      date: "2026-07-29",
      recipientNames: ["LARGER COMPANY"],
      committedAmount: 5000,
      maximumPotentialAmount: 8000,
      ticker: "LRG"
    },
    {
      date: "2026-07-29",
      recipientNames: ["MISSING COMPANY"],
      committedAmount: null,
      maximumPotentialAmount: 1000,
      ticker: "MIS"
    }
  ]);

  assert.ok(section.indexOf("LRG") < section.indexOf("EXM"));
  assert.ok(section.indexOf("EXM") < section.indexOf("MIS"));
});

test("replaces the same date section rather than duplicating it", () => {
  const first = mergeDateSection(
    "# Existing heading\n",
    "2026-07-29",
    renderDateSection("2026-07-29", [entry])
  );
  const second = mergeDateSection(
    first,
    "2026-07-29",
    renderDateSection("2026-07-29", [])
  );
  assert.equal(
    second.match(/<!-- gov-spend:start:2026-07-29 -->/g)?.length,
    1
  );
  assert.doesNotMatch(second, /EXAMPLE INC/);
  assert.match(second, /# Existing heading/);
});
