# PSGC MCP Server

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that provides Philippine Standard Geographic Code (PSGC) data to LLMs. Built on Cloudflare Workers with KV storage.

Public, read-only, no authentication required. Data sourced directly from the [Philippine Statistics Authority](https://psa.gov.ph/classification/psgc/) quarterly PSGC publication. Cached in Cloudflare KV for reliability and low-latency global access.

## Tools

| Tool | Description |
|------|-------------|
| `lookup` | Fetch a geographic entity by its 10-digit PSGC code |
| `search` | Search entities by name with optional level filter and strict mode |
| `get_hierarchy` | Get the full administrative chain (barangay to region) |
| `list_children` | List direct children of a parent entity |
| `list_by_type` | List all entities at a given geographic level |
| `batch_lookup` | Look up multiple entities in one call (max 50 codes) |
| `query_by_population` | Query entities by population range with sorting and filtering |

### Geographic Levels

| Level | Description | Count |
|-------|-------------|-------|
| `Reg` | Region | 18 |
| `Prov` | Province | 82 |
| `Dist` | District (NCR only) | 4 |
| `City` | City | 149 |
| `Mun` | Municipality | 1,493 |
| `SubMun` | Sub-Municipality (Manila only) | 16 |
| `SGU` | Special Geographic Unit (BARMM) | ~8 |
| `Bgy` | Barangay | ~42,000 |

## Response Format

All data responses are wrapped in a standard envelope:

```json
{
  "_meta": {
    "dataset_version": "PSGC Q4 2025",
    "dataset_date": "2025-12-31",
    "last_synced": "2026-03-02",
    "source": "Philippine Statistics Authority (PSA)",
    "source_url": "https://psa.gov.ph/classification/psgc/"
  },
  "data": { ... }
}
```

Error responses (`isError: true`) and informational messages (e.g. "No children found") are returned as plain text without wrapping.

### Entity Schema

Entity objects returned by `lookup`, `get_hierarchy`, `list_children`, `list_by_type`, `batch_lookup`, and `query_by_population` use snake_case field names:

| Field | Type | Description |
|-------|------|-------------|
| `psgc_code` | `string` | 10-digit PSGC code |
| `name` | `string` | Official place name |
| `level` | `string` | Geographic level (Reg, Prov, Dist, City, Mun, SubMun, SGU, Bgy) |
| `old_name` | `string \| null` | Previous name, if renamed |
| `city_class` | `string \| null` | City classification: HUC, ICC, CC, or null |
| `income_class` | `string \| null` | Income classification (1st through 6th) |
| `urban_rural` | `string \| null` | Urban/Rural classification (barangays only) |
| `population` | `number \| null` | 2024 Census population count |
| `parent_code` | `string \| null` | PSGC code of parent entity |

All fields are always present. Fields without data are `null`, never omitted.

### Search Results

The `search` tool returns a lighter result object:

| Field | Type | Description |
|-------|------|-------------|
| `psgc_code` | `string` | 10-digit PSGC code |
| `name` | `string` | Official place name |
| `level` | `string` | Geographic level |

### Strict Search

The `search` tool accepts an optional `strict` boolean parameter. When `strict: true`, only exact name matches are returned (after normalization). Partial and substring matches are excluded. Useful when you know the exact place name and want to avoid ambiguous results.

### Batch Lookup

The `batch_lookup` tool accepts an array of 1-50 PSGC codes and returns results in the same order as input. Codes not found return `null` at their position.

| Field | Type | Description |
|-------|------|-------------|
| `results` | `(Entity \| null)[]` | Entities in input order, `null` for not found |
| `found` | `number` | Count of codes that resolved |
| `not_found` | `number` | Count of codes that returned null |
| `total` | `number` | Total codes requested |

### Query by Population

The `query_by_population` tool finds entities within a population range, sorted by population. Useful for questions like "largest cities in Region III" or "municipalities under 50,000 people."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `level` | `string` | Yes | Geographic level to query |
| `parent_code` | `string` | Bgy only | Scope results to a parent entity (prefix matching). Required for barangays. |
| `min_population` | `number` | No | Minimum population (inclusive) |
| `max_population` | `number` | No | Maximum population (inclusive) |
| `sort` | `asc \| desc` | No | Sort order (default: `desc`) |
| `limit` | `number` | No | Max results, 1-100 (default: 10) |

Response includes `results` (entity array), `total_matching` (total before limit), and `returned` (actual count returned). Entities with null population are excluded.

## Connect

Add to your MCP client configuration:
```json
{
  "mcpServers": {
    "psgc": {
      "url": "https://psgc.godmode.ph/mcp"
    }
  }
}
```

### Quick test
```bash
curl -X POST https://psgc.godmode.ph/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": { "query": "Carmona", "level": "Mun" }
    }
  }'
```

## PSGC Code Format

PSGC codes are 10 digits with no spaces. The segments encode the full geographic hierarchy:
```
1 4 0 2 1 0 0 0 0 0
│ │ └─┬─┘ └─┬─┘ └─┬─┘
│ │   │     │     └── Barangay (last 3 digits)
│ │   │     └──────── Municipality/City (3 digits)
│ │   └────────────── Province (2 digits)
│ └────────────────── Island Group modifier
└──────────────────── Region (1 digit)
```

Leading zeros are significant — `014021000000` and `14021000000` are different codes. Always use the full 10-digit string.

Known edge cases:
- NCR uses **Districts** instead of Provinces (`Dist` level)
- Cotabato City is administratively in BARMM but geographically in Region XII — it appears under `Prov` code `124700000` (Maguindanao del Norte)
- BARMM Special Geographic Units (`SGU`) don't follow the standard hierarchy and have no Province parent

## Data Sources

| Source | Vintage | Description |
|--------|---------|-------------|
| [PSA PSGC Publication](https://psa.gov.ph/classification/psgc/) | Q4 2025 (January 13, 2026) | Geographic codes, names, levels, classifications |
| [2024 Census of Population](https://psa.gov.ph/population-and-housing) | Proclamation No. 973 | Population counts per entity |
| PSA PSGC Old Names column | Q4 2025 | Historical/previous place names |
| PSA PSGC Urban/Rural column | Q4 2025 | Barangay urban/rural classification |

Last synced: March 2, 2026.

## Breaking Changes (v1.1.0+)

- All data responses are now wrapped in `{ _meta, data }`. Consumers must unwrap `data` from the response.
- Entity field names changed to snake_case: `code` is now `psgc_code`, `parent` is now `parent_code`, `cityClass` is now `city_class`, etc.
- Search results use `psgc_code` instead of `code`.
- All entity fields are always present. Previously optional fields now appear as `null` instead of being omitted.
- Internal fields `regionCode` and `provinceCode` are no longer exposed in API responses.

## Related Projects

Part of a suite of Philippine public data MCP servers:

- **PSGC MCP** (this repo)
- **PH Holidays MCP**  -> Coming soon
- **BSP Bank Directory MCP** -> Coming soon

All servers are free, public, and read-only. Data pulled from official Philippine government sources.

## Contributing and Issues

Found a data error or an edge case that isn't handled? Open an issue. The quirks section above covers the most common ones, but PSGC data has accumulated inconsistencies over decades of LGU reclassifications and the issues list is the best place to track them.

PSA publishes updates quarterly. If the data looks stale, open an issue and it will be refreshed ahead of the next scheduled sync.

## Data Pipeline

The PSGC data is parsed from PSA's Excel publication and stored in Cloudflare KV. To update:

### 1. Download the PSGC Excel file

Get the latest publication from [PSA PSGC](https://psa.gov.ph/classification/psgc) and place it in `scripts/data/`.

### 2. Diff (optional)

```bash
npm run diff-psgc -- "scripts/data/Q3 2025/PSGC-3Q-2025-Publication-Datafile.xlsx" "scripts/data/PSGC-4Q-2025-Publication-Datafile (1).xlsx"
```

Compares two quarterly Excel files and reports additions, removals, name changes, and field changes. Run this before the full parse to verify PSA's changelog.

### 3. Parse
```bash
npm run parse-psgc
```

Reads the Excel file, derives parent relationships, and writes chunked JSON files to `scripts/data/output/`.

### 4. Upload to KV
```bash
npm run upload-kv
```

Bulk uploads all JSON chunks to Cloudflare KV via wrangler.

### 5. Deploy
```bash
npm run deploy
```

## Development
```bash
npm install
npm run dev
```

Dev server starts at `http://localhost:8787`. Connect your MCP client to `http://localhost:8787/mcp`.

## Setup

Before first deploy, create the KV namespace:
```bash
npx wrangler kv namespace create PSGC_KV
```

Update `wrangler.jsonc` with the returned namespace ID.

## Built by

**Aaron Zara** - Fractional CTO at [Godmode Digital](https://godmode.ph)

Previously built [REN.PH](https://ren.ph), a programmatic real estate platform with 60,000+ structured geographic pages covering every barangay, city, and province in the Philippines. The PSGC MCP came out of needing reliable, queryable PH geography data for AI agents and not finding anything that fit.

For enterprise SLAs, custom integrations, or other PH data sources:
→ [godmode.ph](https://godmode.ph)

## License

MIT
