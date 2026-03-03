#!/usr/bin/env bash
# 10 real MCP calls against the local dev server.
# Writes results to test/live-sample-responses.json

BASE="http://localhost:8787/mcp"
OUT="$(dirname "$0")/live-sample-responses.json"

call_mcp() {
  local id="$1"
  local tool="$2"
  local args="$3"
  local desc="$4"

  local payload=$(cat <<ENDJSON
{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"${tool}","arguments":${args}}}
ENDJSON
)

  local raw
  raw=$(curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1)

  # Extract the text content from the MCP response
  local text
  text=$(echo "$raw" | jq -r '.result.content[0].text // .error.message // "NO RESPONSE"' 2>/dev/null)

  # Try to parse as JSON, fall back to string
  local parsed
  parsed=$(echo "$text" | jq '.' 2>/dev/null || echo "\"$text\"")

  cat <<ENDJSON2
  {
    "case": ${id},
    "tool": "${tool}",
    "description": "${desc}",
    "args": ${args},
    "response": ${parsed}
  }
ENDJSON2
}

echo "Running 10 live MCP calls..."
echo ""

{
echo '{'
echo '  "generated_at": "'$(date -Iseconds)'",'
echo '  "server": "localhost:8787 (wrangler dev, local KV)",'
echo '  "cases": ['

# 1) Lookup: City of Manila
call_mcp 1 "lookup" '{"code":"1301006000"}' "Lookup: City of Manila (HUC)"
echo ","

# 2) Lookup: Quezon City
call_mcp 2 "lookup" '{"code":"1307404000"}' "Lookup: Quezon City"
echo ","

# 3) Search: Manila (broad)
call_mcp 3 "search" '{"query":"Manila","limit":5}' "Search: Manila (top 5 results)"
echo ","

# 4) Search: Cebu filtered to Province
call_mcp 4 "search" '{"query":"Cebu","level":"Prov"}' "Search: Cebu filtered to Province level"
echo ","

# 5) Search: Davao filtered to City
call_mcp 5 "search" '{"query":"Davao","level":"City"}' "Search: Davao filtered to City level"
echo ","

# 6) Hierarchy: a barangay in Makati
call_mcp 6 "get_hierarchy" '{"code":"1307601001"}' "Hierarchy: Bangkal barangay up to NCR region"
echo ","

# 7) List children: Region III (Central Luzon) provinces
call_mcp 7 "list_children" '{"code":"0300000000","level":"Prov"}' "Children: Central Luzon provinces"
echo ","

# 8) List children: Bulacan cities/municipalities
call_mcp 8 "list_children" '{"code":"0314000000"}' "Children: Bulacan cities and municipalities"
echo ","

# 9) List by type: all regions
call_mcp 9 "list_by_type" '{"level":"Reg"}' "List by type: all 18 regions"
echo ","

# 10) Search: strict mode for Marilao
call_mcp 10 "search" '{"query":"Marilao","strict":true}' "Search strict: exact match Marilao"

echo ''
echo '  ]'
echo '}'
} > "$OUT"

echo "Done. Output: $OUT"
echo "$(jq '.cases | length' "$OUT") cases written."
