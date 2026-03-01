# PSGC MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that provides Philippine Standard Geographic Code (PSGC) data to LLMs. Built on Cloudflare Workers with KV storage.

Public, read-only, no authentication required. Data sourced directly from the [Philippine Statistics Authority](https://psa.gov.ph/classification/psgc/) quarterly PSGC publication — not a third-party mirror. Cached in Cloudflare KV for reliability and low-latency global access.

## Tools

| Tool | Description |
|------|-------------|
| `lookup` | Fetch a geographic entity by its 10-digit PSGC code |
| `search` | Search entities by name with optional level filter |
| `get_hierarchy` | Get the full administrative chain (barangay to region) |
| `list_children` | List direct children of a parent entity |
| `list_by_type` | List all entities at a given geographic level |

### Geographic Levels

- `Reg` - Region (18)
- `Prov` - Province (82)
- `Dist` - District (4, NCR only)
- `City` - City (149)
- `Mun` - Municipality (1,494)
- `SubMun` - Sub-Municipality (16, Manila only)
- `SGU` - Special Geographic Unit (~8, BARMM)
- `Bgy` - Barangay (~42,000)

## Connect

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "psgc": {
      "url": "https://psgc-mcp.godmodearch.workers.dev/mcp"
    }
  }
}
```

## Data Source

Data is sourced directly from the **Philippine Statistics Authority (PSA)** quarterly PSGC publication at [psa.gov.ph/classification/psgc](https://psa.gov.ph/classification/psgc/). Not a third-party mirror.

The dataset is refreshed automatically via Cloudflare Workers Cron Triggers on each new PSA quarterly release. Last synced: March 1, 2026.

## Related Projects

This is part of a suite of Philippine public data MCP servers built by Godmode Digital:

- **PSGC MCP** ← you are here
- **PH Holidays MCP** — coming soon
- **BSP Bank Directory MCP** — coming soon

All servers are free, public, read-only, and sourced directly from official Philippine government publications.

## Contributing & Issues

Found a data error or edge case? Open an issue on GitHub. PSGC has known quirks — NCR districts, Cotabato City classification, BARMM Special Geographic Units — and community reports help keep the data accurate.

PSA publishes PSGC updates quarterly. If you notice the data is stale, open an issue and it will be refreshed manually ahead of the next scheduled sync.

## Data Pipeline

The PSGC data is parsed from PSA's Excel publication and stored in Cloudflare KV. To update the data:

### 1. Download the PSGC Excel file

Get the latest publication from [PSA PSGC](https://psa.gov.ph/classification/psgc) and place it in `scripts/data/`.

### 2. Parse

```bash
npm run parse-psgc
```

Reads the Excel file, derives parent relationships, and writes chunked JSON files to `scripts/data/output/`.

### 3. Upload to KV

```bash
npm run upload-kv
```

Bulk uploads all JSON chunks to Cloudflare KV via wrangler.

### 4. Deploy

```bash
npm run deploy
```

## Development

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:8787`. Connect your MCP client to `http://localhost:8787/mcp`.

## Setup

Before first deploy, create the KV namespace:

```bash
npx wrangler kv namespace create PSGC_KV
```

Update `wrangler.jsonc` with the returned namespace ID.

## Built by

**Aaron Zara** — Fractional CTO & Principal at [Godmode Digital](https://godmode.ph)

Engineer behind [Ren.ph](https://ren.ph) — Philippines' largest programmatic real estate platform with 60,000+ structured geographic pages. The PSGC MCP was built as part of a broader initiative to expose Philippine government data as grounding infrastructure for AI agents.

For enterprise use cases, SLA requirements, or custom PH data integrations:
→ [godmode.ph](https://godmode.ph)

## License

MIT
