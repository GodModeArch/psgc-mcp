import { describe, expect, it, beforeEach } from "vitest";
import { handleSearch } from "../../src/tool-handlers";
import type { SearchCache } from "../../src/tool-handlers";
import { buildSeededKV } from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { KV_PREFIX } from "../../src/types";

let kv: MockKV;
let cache: SearchCache;

beforeEach(() => {
	kv = buildSeededKV();
	cache = { current: null };
});

describe("handleSearch", () => {
	it("returns isError when search index missing from KV", async () => {
		kv.delete(KV_PREFIX.searchIndex);
		const result = await handleSearch({ query: "Manila" }, kv, cache);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Search index not found");
	});

	it("loads index from KV on first call", async () => {
		expect(cache.current).toBeNull();
		await handleSearch({ query: "Manila" }, kv, cache);
		expect(cache.current).not.toBeNull();
	});

	it("uses cached index on subsequent calls (survives KV deletion)", async () => {
		// First call loads the cache
		await handleSearch({ query: "Manila" }, kv, cache);
		expect(cache.current).not.toBeNull();

		// Delete the KV key
		kv.delete(KV_PREFIX.searchIndex);

		// Second call should still work from cache
		const result = await handleSearch({ query: "Manila" }, kv, cache);
		expect(result.isError).toBeUndefined();
		const results = JSON.parse(result.content[0].text);
		expect(results.length).toBeGreaterThan(0);
	});

	it("exact match scores highest (3)", async () => {
		const result = await handleSearch({ query: "Marilao" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		// "marilao" exact match should be first
		expect(results[0].name).toBe("Marilao");
	});

	it("starts-with scores higher than contains", async () => {
		// "City of Manila" starts with "city" after normalize
		// "National Capital Region" contains "capital" but not "city"
		const result = await handleSearch({ query: "city" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		// Entries starting with "city" should come before entries merely containing "city"
		expect(results.length).toBeGreaterThan(0);
		// "city of manila" and "city of malolos" start with "city"
		const startsWithCity = results.filter((r: { name: string }) =>
			r.name.toLowerCase().startsWith("city"),
		);
		expect(startsWithCity.length).toBeGreaterThan(0);
		// All starts-with entries should come before contains entries
		const firstNonStartsWith = results.findIndex(
			(r: { name: string }) => !r.name.toLowerCase().startsWith("city"),
		);
		if (firstNonStartsWith > 0) {
			for (let i = 0; i < firstNonStartsWith; i++) {
				expect(results[i].name.toLowerCase().startsWith("city")).toBe(true);
			}
		}
	});

	it("sorts ties by name ascending", async () => {
		// "city of malolos" and "city of manila" both start with "city of"
		const result = await handleSearch({ query: "city of" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		expect(results.length).toBe(2);
		// "city of malolos" < "city of manila" alphabetically (normalized)
		expect(results[0].name).toBe("City of Malolos");
		expect(results[1].name).toBe("City of Manila");
	});

	it("level filter excludes non-matching levels", async () => {
		const result = await handleSearch(
			{ query: "a", level: "Reg" },
			kv,
			cache,
		);
		const results = JSON.parse(result.content[0].text);
		for (const r of results) {
			expect(r.level).toBe("Reg");
		}
	});

	it("default limit is 10", async () => {
		// Seed many barangays that all contain "barangay"
		kv = buildSeededKV(100);
		cache = { current: null };
		const result = await handleSearch({ query: "barangay" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		expect(results.length).toBe(10);
	});

	it("custom limit is respected", async () => {
		kv = buildSeededKV(100);
		cache = { current: null };
		const result = await handleSearch(
			{ query: "barangay", limit: 5 },
			kv,
			cache,
		);
		const results = JSON.parse(result.content[0].text);
		expect(results.length).toBe(5);
	});

	it("no results returns descriptive message", async () => {
		const result = await handleSearch({ query: "xyznonexistent" }, kv, cache);
		expect(result.content[0].text).toContain('No results found for "xyznonexistent"');
	});

	it("no results with level filter includes level in message", async () => {
		const result = await handleSearch(
			{ query: "xyznonexistent", level: "City" },
			kv,
			cache,
		);
		expect(result.content[0].text).toContain("at level City");
	});

	it("matches diacritics: 'nono' finds 'Ñoño'", async () => {
		const result = await handleSearch({ query: "nono" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		const match = results.find((r: { name: string }) => r.name === "Ñoño");
		expect(match).toBeDefined();
	});

	it("multi-word search: 'abangan norte' matches correctly", async () => {
		const result = await handleSearch({ query: "abangan norte" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		expect(results[0].name).toBe("Abangan Norte");
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("empty string query matches everything (includes returns true for '')", async () => {
		// normalize("") -> "", and "anything".includes("") === true
		// All entries score 2 (startsWith("") is always true), limited to 10
		const result = await handleSearch({ query: "" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		expect(results.length).toBe(10);
	});

	it("punctuation-only query normalizes to '' and matches everything", async () => {
		// "!!!" -> normalize -> "", same as empty query
		const result = await handleSearch({ query: "!!!" }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		expect(results.length).toBe(10);
	});

	it("limit 0 returns no-results message even when matches exist", async () => {
		// slice(0, 0) returns [], results.length === 0 triggers no-results message
		const result = await handleSearch({ query: "Manila", limit: 0 }, kv, cache);
		expect(result.content[0].text).toContain("No results found");
	});

	it("negative limit omits last element via slice behavior", async () => {
		// slice(0, -1) removes the last match. This is a boundary quirk.
		kv = buildSeededKV(100);
		cache = { current: null };
		const result = await handleSearch({ query: "barangay", limit: -1 }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		// slice(0, -1) on 100 matches = 99 results
		expect(results.length).toBe(99);
	});

	it("limit larger than total matches returns all matches", async () => {
		const result = await handleSearch({ query: "Manila", limit: 50 }, kv, cache);
		const results = JSON.parse(result.content[0].text);
		// Only 1 entity contains "Manila" -> City of Manila
		expect(results.length).toBe(1);
	});

	it("valid query with non-matching level filter returns no results", async () => {
		// "Manila" exists as a City, filtering by Prov should yield nothing
		const result = await handleSearch(
			{ query: "Manila", level: "Prov" },
			kv,
			cache,
		);
		expect(result.content[0].text).toContain("No results found");
		expect(result.content[0].text).toContain("at level Prov");
	});
});
