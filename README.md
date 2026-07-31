# Gov Spend Poller

A TypeScript CLI that retrieves the previous day's **initial prime federal
contract awards** from USAspending, identifies recipients associated with
companies listed on Nasdaq, the NYSE, or NYSE American, groups the results into
one row per ticker, and writes an idempotent date section to `gov_spend.md`.

Contract modifications and subcontracts are intentionally excluded.

## Requirements

- Node.js 20 or newer
- Internet access to `api.usaspending.gov`, `files.usaspending.gov`, and
  `www.sec.gov`

No API key is required.

## Install and run

```bash
npm install
npm run poll
```

The default run:

- calculates the previous calendar date in `America/New_York`;
- submits one USAspending bulk-export job filtered to
  `date_type: new_awards_only`;
- checks that job's status at a conservative interval, then downloads one ZIP;
- reads the initial obligation, potential award value, recipient, and parent
  recipient directly from the exported CSV;
- never paginates through 100-row search results;
- never calls the single-award detail endpoint;
- excludes later contract modifications and all subcontracts;
- matches both legal recipients and exported parent recipients against the SEC
  issuer list and configured aliases;
- groups matching awards by ticker and sums both reported dollar fields;
- sorts ticker rows by summed money legally committed from highest to lowest;
- creates `gov_spend.md` if absent and safely replaces the selected date's
  generated section when rerun.

For a reproducible historical run:

```bash
npm run poll -- --date 2025-07-28
```

Build and run the compiled app:

```bash
npm run build
npm start -- --date 2025-07-28
```

Run all checks:

```bash
npm run check
```

Use `npm run poll -- --help` for every option. Useful examples:

```bash
# Write somewhere else
npm run poll -- --output reports/gov_spend.md

# Calculate "previous day" in a different time zone
npm run poll -- --timezone America/Chicago

# Check a slow export every five seconds
npm run poll -- --poll-interval-ms 5000

# Allow up to twenty minutes for a very large export
npm run poll -- --download-timeout-ms 1200000
```

The normal USAspending request count is:

```text
1 export submission + a few status checks + 1 ZIP download
```

The number of exported awards no longer controls the request count. For
example, 18,500 awards still require only one export submission and one archive
download; only the number of status checks varies with generation time.

## Output meanings

`gov_spend.md` contains:

- **Date of entry:** the initial prime award's action date.
- **Corporation receiving the contract:** the distinct legal recipients
  contributing to that ticker's row.
- **Money legally committed:** the sum of `federal_action_obligation` across
  the ticker's matching initial awards.
- **Maximum potential award amount:**
  the sum of `potential_total_value_of_award` across the ticker's matching
  initial awards, including potential options.
- **Stock ticker code:** the grouping key; the output contains one row per
  ticker.

Missing dollar values are excluded from sums rather than treated as zero. A
field is shown as unavailable when no award in that ticker group reports it.
Rows with unavailable committed amounts appear last; ties are sorted by ticker.

## Date behavior

USAspending does not expose the timestamp when a record first became public.
Therefore, “previous day” means the previous day's initial-award action, not
the website publication timestamp.

The bulk export is filtered with `date_type: new_awards_only`, and the app also
checks locally that the action date matches and the modification number is
blank or zero.

## Public-company matching

The app downloads the SEC's
[`company_tickers_exchange.json`](https://www.sec.gov/files/company_tickers_exchange.json)
and restricts matches to Nasdaq, NYSE, and NYSE American. It uses:

1. normalized exact recipient and parent-recipient matches;
2. conservative division-name matches; and
3. explicit aliases in `config/company_aliases.json`.

The export supplies the parent recipient in bulk, so subsidiaries can be
matched without separate per-award requests. Explicit aliases remain useful
when federal recipient records use a trade name or an incomplete parent.

Example:

```json
{
  "aliases": [
    {
      "recipientNames": [
        "EXAMPLE AEROSPACE SYSTEMS, LLC",
        "EXAMPLE FEDERAL SERVICES"
      ],
      "ticker": "EXMPL"
    }
  ]
}
```

The ticker must exist in current SEC data on an allowed exchange.

## Data sources

- [USAspending API endpoints](https://api.usaspending.gov/docs/endpoints)
- [USAspending download-search contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/download/search.md)
- [USAspending download-status contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/download/status.md)
- [USAspending search filter documentation](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/search_filters.md)
- [SEC EDGAR ticker/exchange data documentation](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
