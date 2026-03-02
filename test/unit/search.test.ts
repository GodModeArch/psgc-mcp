import { describe, expect, it, beforeEach } from "vitest";
import { handleSearch } from "../../src/tool-handlers";
import type { SearchCache } from "../../src/tool-handlers";
import { buildSeededKV } from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { KV_PREFIX } from "../../src/types";
import { TEST_META, parseData } from "../fixtures/meta";
import type { ApiSearchResult } from "../../src/response";

let kv: MockKV;
let cache: SearchCache;

beforeEach(() => {
	kv = buildSeededKV();
	cache = { current: null };
});

describe("handleSearch", () => {
	it("returns isError when search index missing from KV", async () => {
		kv.delete(KV_PREFIX.searchIndex);
		const result = await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Search index not found");
	});

	it("loads index from KV on first call", async () => {
		expect(cache.current).toBeNull();
		await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		expect(cache.current).not.toBeNull();
	});

	it("uses cached index on subsequent calls (survives KV deletion)", async () => {
		// First call loads the cache
		await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		expect(cache.current).not.toBeNull();

		// Delete the KV key
		kv.delete(KV_PREFIX.searchIndex);

		// Second call should still work from cache
		const result = await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		expect(result.isError).toBeUndefined();
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBeGreaterThan(0);
	});

	it("exact match scores highest (3)", async () => {
		const result = await handleSearch({ query: "Marilao" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		// "marilao" exact match should be first
		expect(results[0].name).toBe("Marilao");
	});

	it("starts-with scores higher than contains", async () => {
		const result = await handleSearch({ query: "city" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBeGreaterThan(0);
		const startsWithCity = results.filter((r) =>
			r.name.toLowerCase().startsWith("city"),
		);
		expect(startsWithCity.length).toBeGreaterThan(0);
		const firstNonStartsWith = results.findIndex(
			(r) => !r.name.toLowerCase().startsWith("city"),
		);
		if (firstNonStartsWith > 0) {
			for (let i = 0; i < firstNonStartsWith; i++) {
				expect(results[i].name.toLowerCase().startsWith("city")).toBe(true);
			}
		}
	});

	it("sorts ties by name ascending", async () => {
		const result = await handleSearch({ query: "city of" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(2);
		expect(results[0].name).toBe("City of Malolos");
		expect(results[1].name).toBe("City of Manila");
	});

	it("level filter excludes non-matching levels", async () => {
		const result = await handleSearch(
			{ query: "a", level: "Reg" },
			kv,
			cache,
			TEST_META,
		);
		const results = parseData<ApiSearchResult[]>(result);
		for (const r of results) {
			expect(r.level).toBe("Reg");
		}
	});

	it("default limit is 10", async () => {
		kv = buildSeededKV(100);
		cache = { current: null };
		const result = await handleSearch({ query: "barangay" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(10);
	});

	it("custom limit is respected", async () => {
		kv = buildSeededKV(100);
		cache = { current: null };
		const result = await handleSearch(
			{ query: "barangay", limit: 5 },
			kv,
			cache,
			TEST_META,
		);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(5);
	});

	it("no results returns descriptive message (not wrapped)", async () => {
		const result = await handleSearch({ query: "xyznonexistent" }, kv, cache, TEST_META);
		expect(result.content[0].text).toContain('No results found for "xyznonexistent"');
	});

	it("no results with level filter includes level in message", async () => {
		const result = await handleSearch(
			{ query: "xyznonexistent", level: "City" },
			kv,
			cache,
			TEST_META,
		);
		expect(result.content[0].text).toContain("at level City");
	});

	it("matches diacritics: 'nono' finds 'Ñoño'", async () => {
		const result = await handleSearch({ query: "nono" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		const match = results.find((r) => r.name === "Ñoño");
		expect(match).toBeDefined();
	});

	it("multi-word search: 'abangan norte' matches correctly", async () => {
		const result = await handleSearch({ query: "abangan norte" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results[0].name).toBe("Abangan Norte");
	});

	it("search results use psgc_code field", async () => {
		const result = await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results[0]).toHaveProperty("psgc_code");
		expect(results[0]).not.toHaveProperty("code");
	});

	// ── Strict search ─────────────────────────────────────────────

	it("strict: true returns only exact name matches", async () => {
		const result = await handleSearch(
			{ query: "Marilao", strict: true },
			kv,
			cache,
			TEST_META,
		);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(1);
		expect(results[0].name).toBe("Marilao");
	});

	it("strict: true returns no results for partial match", async () => {
		const result = await handleSearch(
			{ query: "Mari", strict: true },
			kv,
			cache,
			TEST_META,
		);
		expect(result.content[0].text).toContain('No results found for "Mari"');
	});

	it("strict: true with level filter", async () => {
		const result = await handleSearch(
			{ query: "Bulacan", strict: true, level: "Prov" },
			kv,
			cache,
			TEST_META,
		);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(1);
		expect(results[0].name).toBe("Bulacan");
		expect(results[0].level).toBe("Prov");
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("empty string query matches everything (includes returns true for '')", async () => {
		const result = await handleSearch({ query: "" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(10);
	});

	it("punctuation-only query normalizes to '' and matches everything", async () => {
		const result = await handleSearch({ query: "!!!" }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(10);
	});

	it("limit 0 returns no-results message even when matches exist", async () => {
		const result = await handleSearch({ query: "Manila", limit: 0 }, kv, cache, TEST_META);
		expect(result.content[0].text).toContain("No results found");
	});

	it("negative limit omits last element via slice behavior", async () => {
		kv = buildSeededKV(100);
		cache = { current: null };
		const result = await handleSearch({ query: "barangay", limit: -1 }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		// slice(0, -1) on 100 matches = 99 results
		expect(results.length).toBe(99);
	});

	it("limit larger than total matches returns all matches", async () => {
		const result = await handleSearch({ query: "Manila", limit: 50 }, kv, cache, TEST_META);
		const results = parseData<ApiSearchResult[]>(result);
		expect(results.length).toBe(1);
	});

	it("valid query with non-matching level filter returns no results", async () => {
		const result = await handleSearch(
			{ query: "Manila", level: "Prov" },
			kv,
			cache,
			TEST_META,
		);
		expect(result.content[0].text).toContain("No results found");
		expect(result.content[0].text).toContain("at level Prov");
	});
});
