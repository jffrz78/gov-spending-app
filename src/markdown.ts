import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { OutputEntry } from "./types.js";

const FILE_HEADING = `# Government contract spending involving public companies

Generated from initial USAspending prime contract awards and SEC ticker/exchange associations.
`;

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function currency(value: number | null, missingText: string): string {
  if (value === null) {
    return missingText;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function recipients(values: string[]): string {
  return values.map(escapeCell).join("<br>");
}

export function renderDateSection(date: string, entries: OutputEntry[]): string {
  const startMarker = `<!-- gov-spend:start:${date} -->`;
  const endMarker = `<!-- gov-spend:end:${date} -->`;
  const sorted = [...entries].sort((left, right) => {
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

  const lines = [
    startMarker,
    `## ${date}`,
    "",
    "| Date of entry | Corporation receiving the contract | Money legally committed* | Maximum potential award amount* | Stock ticker code |",
    "|---|---|---:|---:|---|"
  ];

  if (sorted.length === 0) {
    lines.push(`| ${date} | No matching entries | — | — | — |`);
  } else {
    for (const entry of sorted) {
      lines.push(
        [
          entry.date,
          recipients(entry.recipientNames),
          currency(entry.committedAmount, "Not reported"),
          currency(entry.maximumPotentialAmount, "Not available"),
          escapeCell(entry.ticker)
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
      );
    }
  }

  lines.push(
    "",
    "\\* Amounts are summed across all matching initial prime contract awards for each ticker. Missing values are excluded from a sum and shown as unavailable when every value is missing.",
    "",
    "_“Date of entry” is the initial award's USAspending action date. The API does not expose the record's public-posting timestamp._",
    endMarker
  );

  return `${lines.join("\n")}\n`;
}

export function mergeDateSection(
  existing: string,
  date: string,
  section: string
): string {
  const startMarker = `<!-- gov-spend:start:${date} -->`;
  const endMarker = `<!-- gov-spend:end:${date} -->`;
  const start = existing.indexOf(startMarker);
  const end = existing.indexOf(endMarker);

  if (start >= 0 && end >= start) {
    const afterEnd = end + endMarker.length;
    return `${existing.slice(0, start)}${section.trimEnd()}${existing.slice(afterEnd)}`;
  }

  const base = existing.trim()
    ? existing.trimEnd()
    : FILE_HEADING.trimEnd();
  return `${base}\n\n${section}`;
}

export async function writeGovSpendMarkdown(
  outputPath: string,
  date: string,
  entries: OutputEntry[]
): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(outputPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const merged = mergeDateSection(existing, date, renderDateSection(date, entries));
  const directory = dirname(outputPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, merged, "utf8");
  await rename(temporaryPath, outputPath);
}
