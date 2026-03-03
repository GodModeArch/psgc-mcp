/**
 * Calls tool handlers directly against the real local KV data
 * and writes 10 sample responses to test/live-sample-responses.json
 *
 * Run: npx tsx test/live-sample-runner.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	handleLookup,
	handleSearch,
	handleGetHierarchy,
	handleListChildren,
	handleListByType,
} from "../src/tool-handlers";
import type { ToolResult, SearchCache } from "../src/tool-handlers";
import { buildMeta } from "../src/response";
import type { ApiMeta } from "../src/response";

// ── Load real KV data from parsed output files ──────────────────────

async function loadKVFromFiles(): Promise<Map<string, string>> {
	const kvMap = new Map<string, string>();

	// Miniflare v3 uses SQLite for metadata + blob storage
	// Let's just load the parsed JSON output files directly instead
	const outputDir = join(__dirname, "..", "scripts", "data", "output");
	const files = readdirSync(outputDir).filter((f) => f.endsWith(".json"));

	for (const file of files) {
		const raw = readFileSync(join(outputDir, file), "utf-8");
		const entries: Array<{ key: string; value: string }> = JSON.parse(raw);
		for (const entry of entries) {
			kvMap.set(entry.key, entry.value);
		}
	}

	return kvMap;
}

// Simple KV adapter that wraps a Map
class RealKV {
	constructor(private store: Map<string, string>) {}
	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}
}

interface SampleCase {
	case_number: number;
	tool: string;
	description: string;
	args: Record<string, unknown>;
	response: unknown;
	is_error?: boolean;
}

function parseResponse(result: ToolResult): unknown {
	const text = result.content[0].text;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function main() {
	console.log("Loading real KV data from parsed output files...");
	const kvMap = await loadKVFromFiles();
	console.log(`Loaded ${kvMap.size} KV entries`);

	const kv = new RealKV(kvMap);
	const cache: SearchCache = { current: null };
	const meta: ApiMeta = buildMeta({
		datasetVersion: "PSGC Q4 2025",
		datasetDate: "2025-12-31",
		lastSynced: "2026-03-02",
	});

	const cases: SampleCase[] = [];

	// ── Case 1: Lookup City of Manila ──
	console.log("1/10 Lookup: City of Manila...");
	let result = await handleLookup({ code: "1380600000" }, kv, meta);
	cases.push({
		case_number: 1,
		tool: "lookup",
		description: "City of Manila - Highly Urbanized City in NCR",
		args: { code: "1380600000" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 2: Lookup Quezon City ──
	console.log("2/10 Lookup: Quezon City...");
	result = await handleLookup({ code: "1381300000" }, kv, meta);
	cases.push({
		case_number: 2,
		tool: "lookup",
		description: "Quezon City - most populous city in the Philippines",
		args: { code: "1381300000" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 3: Search "Cebu" Province ──
	console.log("3/10 Search: Cebu (Province)...");
	result = await handleSearch({ query: "Cebu", level: "Prov" }, kv, cache, meta);
	cases.push({
		case_number: 3,
		tool: "search",
		description: "Search for Cebu filtered to Province level",
		args: { query: "Cebu", level: "Prov" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 4: Search "Davao" City ──
	console.log("4/10 Search: Davao (City)...");
	result = await handleSearch({ query: "Davao", level: "City" }, kv, cache, meta);
	cases.push({
		case_number: 4,
		tool: "search",
		description: "Search for Davao filtered to City level",
		args: { query: "Davao", level: "City" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 5: Search "Manila" broad ──
	console.log("5/10 Search: Manila (broad, limit 5)...");
	result = await handleSearch({ query: "Manila", limit: 5 }, kv, cache, meta);
	cases.push({
		case_number: 5,
		tool: "search",
		description: "Broad search for Manila - matches city, district, sub-municipalities, barangays",
		args: { query: "Manila", limit: 5 },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 6: Hierarchy from a Makati barangay ──
	console.log("6/10 Hierarchy: Makati barangay -> Region...");
	result = await handleGetHierarchy({ code: "1380300001" }, kv, meta);
	cases.push({
		case_number: 6,
		tool: "get_hierarchy",
		description: "Full admin chain from Bangkal (Makati barangay) up to NCR region",
		args: { code: "1380300001" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 7: Children of Central Luzon (provinces) ──
	console.log("7/10 Children: Central Luzon provinces...");
	result = await handleListChildren({ code: "0300000000", level: "Prov" }, kv, meta);
	cases.push({
		case_number: 7,
		tool: "list_children",
		description: "All provinces under Region III (Central Luzon)",
		args: { code: "0300000000", level: "Prov" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 8: Children of Bulacan ──
	console.log("8/10 Children: Bulacan cities/municipalities...");
	result = await handleListChildren({ code: "0301400000" }, kv, meta);
	cases.push({
		case_number: 8,
		tool: "list_children",
		description: "All cities and municipalities in Bulacan",
		args: { code: "0301400000" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 9: All regions ──
	console.log("9/10 List by type: all regions...");
	result = await handleListByType({ level: "Reg" }, kv, meta);
	cases.push({
		case_number: 9,
		tool: "list_by_type",
		description: "All 18 Philippine regions with population data",
		args: { level: "Reg" },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Case 10: Strict search Marilao ──
	console.log("10/10 Search strict: Marilao...");
	result = await handleSearch({ query: "Marilao", strict: true }, kv, cache, meta);
	cases.push({
		case_number: 10,
		tool: "search",
		description: "Strict exact-match search for Marilao",
		args: { query: "Marilao", strict: true },
		response: parseResponse(result),
		is_error: result.isError,
	});

	// ── Write output ──
	const output = {
		generated_at: new Date().toISOString(),
		data_source: "Real PSGC Q4 2025 parsed data (scripts/data/output/*.json)",
		api_version: "1.1.0",
		total_cases: cases.length,
		cases,
	};

	const outPath = join(__dirname, "live-sample-responses.json");
	writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
	console.log(`\nDone! ${cases.length} cases written to ${outPath}`);
}

main().catch(console.error);
