/**
 * Generates sample responses for every MCP tool and writes them to
 * test/sample-responses.json for manual review.
 *
 * Run: npx vitest run test/generate-samples.ts
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	handleLookup,
	handleSearch,
	handleGetHierarchy,
	handleListChildren,
	handleListByType,
} from "../../src/tool-handlers";
import { buildSeededKV } from "../fixtures/entities";
import { TEST_META } from "../fixtures/meta";
import type { ToolResult } from "../../src/tool-handlers";

const kv = buildSeededKV(5); // 5 extra barangays for batch testing
const cache = { current: null };

interface SampleCase {
	tool: string;
	description: string;
	args: Record<string, unknown>;
	response: unknown;
	isError?: boolean;
}

function parseResponse(result: ToolResult): unknown {
	const text = result.content[0].text;
	try {
		return JSON.parse(text);
	} catch {
		return text; // plain text for error/informational messages
	}
}

describe("generate sample responses", () => {
	const samples: SampleCase[] = [];

	// ── LOOKUP ───────────────────────────────────────────────────────

	it("lookup: City of Manila", async () => {
		const args = { code: "1301006000" };
		const result = await handleLookup(args, kv, TEST_META);
		samples.push({
			tool: "lookup",
			description: "Fetch a highly-urbanized city (City of Manila)",
			args,
			response: parseResponse(result),
		});
	});

	it("lookup: Barangay Abangan Norte", async () => {
		const args = { code: "0314024001" };
		const result = await handleLookup(args, kv, TEST_META);
		samples.push({
			tool: "lookup",
			description: "Fetch a barangay with urban_rural classification",
			args,
			response: parseResponse(result),
		});
	});

	it("lookup: NCR Region", async () => {
		const args = { code: "1300000000" };
		const result = await handleLookup(args, kv, TEST_META);
		samples.push({
			tool: "lookup",
			description: "Fetch a region (top-level, no parent)",
			args,
			response: parseResponse(result),
		});
	});

	it("lookup: Bulacan Province (with income class)", async () => {
		const args = { code: "0314000000" };
		const result = await handleLookup(args, kv, TEST_META);
		samples.push({
			tool: "lookup",
			description: "Fetch a province with income_class populated",
			args,
			response: parseResponse(result),
		});
	});

	it("lookup: Kalayaan Islands (SGU)", async () => {
		const args = { code: "9900100000" };
		const result = await handleLookup(args, kv, TEST_META);
		samples.push({
			tool: "lookup",
			description: "Fetch a Special Geographic Unit (Kalayaan Islands)",
			args,
			response: parseResponse(result),
		});
	});

	it("lookup: invalid code (error)", async () => {
		const args = { code: "0000000000" };
		const result = await handleLookup(args, kv, TEST_META);
		samples.push({
			tool: "lookup",
			description: "Error: non-existent PSGC code",
			args,
			response: parseResponse(result),
			isError: result.isError,
		});
	});

	// ── SEARCH ───────────────────────────────────────────────────────

	it("search: broad query 'Manila'", async () => {
		const args = { query: "Manila" };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "Broad search for 'Manila' (matches city, district, sub-municipalities)",
			args,
			response: parseResponse(result),
		});
	});

	it("search: query with level filter", async () => {
		const args = { query: "Malolos", level: "City" as const };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "Search for 'Malolos' filtered to City level only",
			args,
			response: parseResponse(result),
		});
	});

	it("search: strict mode exact match", async () => {
		const args = { query: "Marilao", strict: true };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "Strict search: only exact normalized name matches",
			args,
			response: parseResponse(result),
		});
	});

	it("search: diacritic-insensitive (Ñoño)", async () => {
		const args = { query: "nono" };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "Diacritic-insensitive: 'nono' matches 'Ñoño'",
			args,
			response: parseResponse(result),
		});
	});

	it("search: custom limit", async () => {
		const args = { query: "a", limit: 3 };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "Search with limit=3 (letter 'a' matches many entities)",
			args,
			response: parseResponse(result),
		});
	});

	it("search: no results", async () => {
		const args = { query: "Atlantis" };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "No results found (informational, not an error)",
			args,
			response: parseResponse(result),
		});
	});

	it("search: strict mode no match", async () => {
		const args = { query: "Man", strict: true };
		const result = await handleSearch(args, kv, cache, TEST_META);
		samples.push({
			tool: "search",
			description: "Strict mode: partial match 'Man' does NOT match 'Manila'",
			args,
			response: parseResponse(result),
		});
	});

	// ── GET HIERARCHY ────────────────────────────────────────────────

	it("get_hierarchy: barangay to region", async () => {
		const args = { code: "0314024001" };
		const result = await handleGetHierarchy(args, kv, TEST_META);
		samples.push({
			tool: "get_hierarchy",
			description: "Full chain: Abangan Norte (Bgy) -> Marilao (Mun) -> Bulacan (Prov) -> Central Luzon (Reg)",
			args,
			response: parseResponse(result),
		});
	});

	it("get_hierarchy: city in NCR", async () => {
		const args = { code: "1301006000" };
		const result = await handleGetHierarchy(args, kv, TEST_META);
		samples.push({
			tool: "get_hierarchy",
			description: "Manila (City) -> NCR First District (Dist) -> NCR (Reg)",
			args,
			response: parseResponse(result),
		});
	});

	it("get_hierarchy: region (already top-level)", async () => {
		const args = { code: "1300000000" };
		const result = await handleGetHierarchy(args, kv, TEST_META);
		samples.push({
			tool: "get_hierarchy",
			description: "NCR Region is already top-level; returns single-element array",
			args,
			response: parseResponse(result),
		});
	});

	it("get_hierarchy: invalid code", async () => {
		const args = { code: "0000000000" };
		const result = await handleGetHierarchy(args, kv, TEST_META);
		samples.push({
			tool: "get_hierarchy",
			description: "Error: non-existent code",
			args,
			response: parseResponse(result),
			isError: result.isError,
		});
	});

	// ── LIST CHILDREN ────────────────────────────────────────────────

	it("list_children: Bulacan province", async () => {
		const args = { code: "0314000000" };
		const result = await handleListChildren(args, kv, TEST_META);
		samples.push({
			tool: "list_children",
			description: "Children of Bulacan: City of Malolos + Marilao",
			args,
			response: parseResponse(result),
		});
	});

	it("list_children: Marilao municipality (barangay children)", async () => {
		const args = { code: "0314024000" };
		const result = await handleListChildren(args, kv, TEST_META);
		samples.push({
			tool: "list_children",
			description: "Children of Marilao: barangays (Abangan Norte, Ñoño, generated bgys)",
			args,
			response: parseResponse(result),
		});
	});

	it("list_children: NCR with level filter", async () => {
		const args = { code: "1300000000", level: "City" as const };
		const result = await handleListChildren(args, kv, TEST_META);
		samples.push({
			tool: "list_children",
			description: "NCR children filtered to City level only (Quezon City)",
			args,
			response: parseResponse(result),
		});
	});

	it("list_children: leaf node (no children)", async () => {
		const args = { code: "0314024001" };
		const result = await handleListChildren(args, kv, TEST_META);
		samples.push({
			tool: "list_children",
			description: "Barangay has no children (leaf level)",
			args,
			response: parseResponse(result),
		});
	});

	// ── LIST BY TYPE ─────────────────────────────────────────────────

	it("list_by_type: all regions", async () => {
		const args = { level: "Reg" as const };
		const result = await handleListByType(args, kv, TEST_META);
		samples.push({
			tool: "list_by_type",
			description: "All regions in the dataset",
			args,
			response: parseResponse(result),
		});
	});

	it("list_by_type: all provinces", async () => {
		const args = { level: "Prov" as const };
		const result = await handleListByType(args, kv, TEST_META);
		samples.push({
			tool: "list_by_type",
			description: "All provinces in the dataset",
			args,
			response: parseResponse(result),
		});
	});

	it("list_by_type: all municipalities", async () => {
		const args = { level: "Mun" as const };
		const result = await handleListByType(args, kv, TEST_META);
		samples.push({
			tool: "list_by_type",
			description: "All municipalities in the dataset",
			args,
			response: parseResponse(result),
		});
	});

	it("list_by_type: SGU (Special Geographic Units)", async () => {
		const args = { level: "SGU" as const };
		const result = await handleListByType(args, kv, TEST_META);
		samples.push({
			tool: "list_by_type",
			description: "All SGUs (e.g., Kalayaan Islands)",
			args,
			response: parseResponse(result),
		});
	});

	// ── WRITE OUTPUT ─────────────────────────────────────────────────

	it("writes all samples to file", () => {
		const output = {
			generated_at: new Date().toISOString(),
			test_dataset: "Fixture entities (NCR, Central Luzon, MIMAROPA, Manila, Bulacan, etc.)",
			api_version: "1.1.0",
			total_cases: samples.length,
			cases: samples,
		};

		const outPath = join(__dirname, "..", "sample-responses.json");
		writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

		expect(samples.length).toBeGreaterThan(0);
		expect(outPath).toBeTruthy();
	});
});
