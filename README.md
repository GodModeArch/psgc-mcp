# PSGC MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that provides Philippine Standard Geographic Code (PSGC) data to LLMs. Built on Cloudflare Workers with KV storage.

Public, read-only, no authentication required. Data sourced from the [Philippine Statistics Authority](https://psa.gov.ph/classification/psgc) quarterly PSGC publication.

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

## License

MIT
