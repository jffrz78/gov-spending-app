import { readFile } from "node:fs/promises";

import type {
  CompanyAliasFile,
  CompanyMatch,
  SecCompany
} from "./types.js";

const LEGAL_SUFFIXES = new Set([
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "INC",
  "INCORPORATED",
  "LLC",
  "LTD",
  "LIMITED",
  "LP",
  "LLP",
  "PLC",
  "HOLDING",
  "HOLDINGS",
  "GROUP"
]);

const DIVISION_WORDS = new Set([
  "AERONAUTICS",
  "AEROSPACE",
  "DEFENSE",
  "FEDERAL",
  "GOVERNMENT",
  "INFORMATION",
  "INNOVATIONS",
  "MISSION",
  "SERVICES",
  "SOLUTIONS",
  "SYSTEMS",
  "TECHNOLOGIES",
  "TECHNOLOGY"
]);

export function normalizeCompanyName(value: string): string {
  const tokens = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\/[^/]*(?:\/|$)/g, " ")
    .replace(/&/g, " AND ")
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens[0] === "THE") {
    tokens.shift();
  }
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens.at(-1)!)) {
    tokens.pop();
  }

  return tokens.join(" ");
}

export async function loadCompanyAliases(
  path: string
): Promise<CompanyAliasFile> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as CompanyAliasFile;
    if (!parsed || !Array.isArray(parsed.aliases)) {
      throw new Error('Alias file must contain an "aliases" array.');
    }
    for (const [index, alias] of parsed.aliases.entries()) {
      if (
        !alias ||
        !Array.isArray(alias.recipientNames) ||
        alias.recipientNames.length === 0 ||
        typeof alias.ticker !== "string" ||
        !alias.ticker.trim()
      ) {
        throw new Error(`Alias entry ${index + 1} is invalid.`);
      }
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { aliases: [] };
    }
    throw error;
  }
}

function divisionMatch(candidate: string, issuer: string): boolean {
  if (!candidate.startsWith(`${issuer} `)) {
    return false;
  }
  const issuerTokenCount = issuer.split(" ").length;
  if (issuer.length < 8 || issuerTokenCount < 2) {
    return false;
  }
  const extra = candidate.slice(issuer.length + 1).split(" ");
  return extra.length > 0 && extra.every((token) => DIVISION_WORDS.has(token));
}

export class PublicCompanyMatcher {
  private readonly exact = new Map<string, SecCompany[]>();
  private readonly aliases = new Map<string, SecCompany>();
  private readonly issuers: Array<{ normalized: string; company: SecCompany }>;

  constructor(companies: SecCompany[], aliasFile: CompanyAliasFile) {
    this.issuers = companies.map((company) => ({
      normalized: normalizeCompanyName(company.name),
      company
    }));

    for (const item of this.issuers) {
      const matches = this.exact.get(item.normalized) ?? [];
      matches.push(item.company);
      this.exact.set(item.normalized, matches);
    }

    const byTicker = new Map<string, SecCompany>();
    for (const company of companies) {
      for (const ticker of company.tickers) {
        byTicker.set(ticker.toUpperCase(), company);
      }
    }

    for (const alias of aliasFile.aliases) {
      const company = byTicker.get(alias.ticker.toUpperCase());
      if (!company) {
        throw new Error(
          `Configured alias ticker "${alias.ticker}" is not present on an allowed SEC exchange.`
        );
      }
      for (const name of alias.recipientNames) {
        const normalized = normalizeCompanyName(name);
        const existing = this.aliases.get(normalized);
        if (existing && existing.cik !== company.cik) {
          throw new Error(`Alias "${name}" maps to more than one public issuer.`);
        }
        this.aliases.set(normalized, company);
      }
    }
  }

  match(
    recipientName: string,
    parentRecipientName?: string | null
  ): CompanyMatch | null {
    const candidates = [
      { value: recipientName, method: "recipient-name" as const },
      ...(parentRecipientName
        ? [{ value: parentRecipientName, method: "parent-name" as const }]
        : [])
    ];

    for (const candidate of candidates) {
      const normalized = normalizeCompanyName(candidate.value);
      const alias = this.aliases.get(normalized);
      if (alias) {
        return {
          issuer: alias,
          matchedName: candidate.value,
          method: "configured-alias"
        };
      }

      const exact = this.exact.get(normalized);
      if (exact?.length === 1) {
        return {
          issuer: exact[0]!,
          matchedName: candidate.value,
          method: candidate.method
        };
      }

      const divisions = this.issuers.filter((issuer) =>
        divisionMatch(normalized, issuer.normalized)
      );
      const uniqueCiks = new Set(divisions.map((item) => item.company.cik));
      if (divisions.length > 0 && uniqueCiks.size === 1) {
        return {
          issuer: divisions[0]!.company,
          matchedName: candidate.value,
          method: candidate.method
        };
      }
    }

    return null;
  }
}
