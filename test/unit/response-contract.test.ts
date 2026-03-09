/**
 * Response Contract Tests (v1.1.0)
 *
 * Verifies the API response envelope contract across all 5 tool handlers:
 * - Data responses are wrapped in { _meta, data }
 * - Error/informational responses stay as plain text (not wrapped)
 * - Internal fields (regionCode, provinceCode) never leak through
 * - All entity fields present (null, never undefined/omitted)
 * - snake_case field naming at the API boundary
 * - Legacy KV backward compatibility (old data missing fields)
 * - Strict search edge cases
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
	handleLookup,
	handleSearch,
	handleGetHierarchy,
	handleListChildren,
	handleListByType,
} from "../../src/tool-handlers";
import type { SearchCache } from "../../src/tool-handlers";
import {
	buildSeededKV,
	MANILA,
	NCR,
	BULACAN,
	MARILAO,
	ABANGAN_NORTE,
	NONO_BGY,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parseEnvelope } from "../fixtures/meta";
import type { ApiEntity, ApiSearchResult } from "../../src/response";

let kv: MockKV;
let cache: SearchCache;

beforeEach(() => {
	kv = buildSeededKV();
	cache = { current: null };
});

// ── Allowed fields (whitelist) ──────────────────────────────────────

const ENTITY_FIELDS = [
	"psgc_code",
	"name",
	"level",
	"old_name",
	"city_class",
	"income_class",
	"urban_rural",
	"population",
	"parent_code",
	"child_counts",
];

const SEARCH_RESULT_FIELDS = ["psgc_code", "name", "level"];

const FORBIDDEN_FIELDS = [
	"code",
	"regionCode",
	"region_code",
	"provinceCode",
	"province_code",
	"parent",
	"oldName",
	"old_name_camel",
	"cityClass",
	"incomeClass",
	"urbanRural",
];

// ── 1. _meta consistency across all handlers ────────────────────────

describe("_meta present in all wrapped responses", () => {
	it("lookup wraps with _meta", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity>(result);
		expect(envelope._meta).toEqual(TEST_META);
	});

	it("search wraps with _meta", async () => {
		const result = await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		const envelope = parseEnvelope<ApiSearchResult[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
	});

	it("get_hierarchy wraps with _meta", async () => {
		const result = await handleGetHierarchy({ code: MANILA.code }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
	});

	it("list_children wraps with _meta", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
	});

	it("list_by_type wraps with _meta", async () => {
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
	});
});

// ── 2. Error/informational responses NOT wrapped ────────────────────

describe("error and informational responses stay plain text", () => {
	it("lookup error: not wrapped", async () => {
		const result = await handleLookup({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		const text = result.content[0].text;
		expect(() => JSON.parse(text)).toThrow(); // plain text, not JSON
	});

	it("search error (missing index): not wrapped", async () => {
		kv.delete("search:index");
		const result = await handleSearch({ query: "Manila" }, kv, cache, TEST_META);
		expect(result.isError).toBe(true);
		const text = result.content[0].text;
		expect(() => JSON.parse(text)).toThrow();
	});

	it("search no results: not wrapped", async () => {
		const result = await handleSearch({ query: "xyznonexistent" }, kv, cache, TEST_META);
		expect(result.isError).toBeUndefined();
		const text = result.content[0].text;
		expect(() => JSON.parse(text)).toThrow();
		expect(text).toContain("No results found");
	});

	it("get_hierarchy error: not wrapped", async () => {
		const result = await handleGetHierarchy({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		const text = result.content[0].text;
		expect(() => JSON.parse(text)).toThrow();
	});

	it("list_children error (no children key): not wrapped", async () => {
		const result = await handleListChildren({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		const text = result.content[0].text;
		expect(() => JSON.parse(text)).toThrow();
		expect(text).toContain("No children found");
	});

	it("list_by_type error (missing index): not wrapped", async () => {
		const result = await handleListByType({ level: "Bgy" as "Reg" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		const text = result.content[0].text;
		expect(() => JSON.parse(text)).toThrow();
	});
});

// ── 3. Response shape purity (no internal field leaks) ──────────────

describe("internal fields excluded from all handler responses", () => {
	it("lookup: entity has exact field set", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity>(result);
		expect(Object.keys(data).sort()).toEqual([...ENTITY_FIELDS].sort());
		for (const field of FORBIDDEN_FIELDS) {
			expect(data).not.toHaveProperty(field);
		}
	});

	it("get_hierarchy: every entity in chain has exact field set", async () => {
		const result = await handleGetHierarchy({ code: ABANGAN_NORTE.code }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity[]>(result);
		expect(data.length).toBeGreaterThanOrEqual(3);
		for (const entity of data) {
			expect(Object.keys(entity).sort()).toEqual([...ENTITY_FIELDS].sort());
			for (const field of FORBIDDEN_FIELDS) {
				expect(entity).not.toHaveProperty(field);
			}
		}
	});

	it("list_children: every child has exact field set", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity[]>(result);
		for (const entity of data) {
			expect(Object.keys(entity).sort()).toEqual([...ENTITY_FIELDS].sort());
		}
	});

	it("list_by_type: every entity has exact field set", async () => {
		const result = await handleListByType({ level: "City" }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity[]>(result);
		for (const entity of data) {
			expect(Object.keys(entity).sort()).toEqual([...ENTITY_FIELDS].sort());
		}
	});

	it("search: every result has exact field set", async () => {
		const result = await handleSearch({ query: "a" }, kv, cache, TEST_META);
		const { data } = parseEnvelope<ApiSearchResult[]>(result);
		for (const r of data) {
			expect(Object.keys(r).sort()).toEqual([...SEARCH_RESULT_FIELDS].sort());
		}
	});
});

// ── 4. All entity fields present (null, never undefined) ────────────

describe("null completeness: no undefined values in entity responses", () => {
	it("lookup: all fields are non-undefined (null or value)", async () => {
		// NCR has no cityClass, incomeClass, urbanRural, parent, provinceCode
		const result = await handleLookup({ code: NCR.code }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity>(result);
		for (const [key, value] of Object.entries(data)) {
			expect(value, `field '${key}' should not be undefined`).not.toBeUndefined();
		}
		// Verify the nulls specifically
		expect(data.old_name).toBeNull();
		expect(data.city_class).toBeNull();
		expect(data.income_class).toBeNull();
		expect(data.urban_rural).toBeNull();
		expect(data.parent_code).toBeNull();
	});

	it("list_children: null fields serialized as null in JSON (not omitted)", async () => {
		const result = await handleListChildren({ code: MARILAO.code }, kv, TEST_META);
		const raw = result.content[0].text;
		// Parse and check a barangay that has mostly null fields
		const { data } = JSON.parse(raw) as { data: ApiEntity[] };
		const nono = data.find((e) => e.name === "Ñoño");
		expect(nono).toBeDefined();
		// These should be literal null in the JSON, not missing keys
		expect(raw).toContain('"old_name": null');
		expect(raw).toContain('"city_class": null');
		expect(raw).toContain('"population": null');
	});
});

// ── 5. Legacy KV backward compat through handlers ──────────────────

describe("backward compatibility with old KV data (missing fields)", () => {
	it("lookup: old-format entity (optional fields absent) gets null-filled", async () => {
		// Simulate pre-v1.1 KV data that used optional fields
		kv.seed({
			"entity:0100000000": JSON.stringify({
				code: "0100000000",
				name: "Ilocos Region",
				level: "Reg",
				regionCode: "0100000000",
				population: 5301139,
			}),
		});

		const result = await handleLookup({ code: "0100000000" }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity>(result);
		expect(data.psgc_code).toBe("0100000000");
		expect(data.name).toBe("Ilocos Region");
		expect(data.population).toBe(5301139);
		// Missing fields in KV should become null via ?? null
		expect(data.old_name).toBeNull();
		expect(data.city_class).toBeNull();
		expect(data.income_class).toBeNull();
		expect(data.urban_rural).toBeNull();
		expect(data.parent_code).toBeNull();
	});

	it("get_hierarchy: chain with mixed old/new format entities", async () => {
		// Old-format parent (missing optional fields), new-format child
		kv.seed({
			"entity:9900000000": JSON.stringify({
				code: "9900000000",
				name: "Old Region",
				level: "Reg",
				regionCode: "9900000000",
			}),
			"entity:9901000000": JSON.stringify({
				code: "9901000000",
				name: "New Province",
				level: "Prov",
				parent: "9900000000",
				oldName: null,
				cityClass: null,
				incomeClass: "2nd",
				urbanRural: null,
				population: 500000,
				regionCode: "9900000000",
				provinceCode: "9901000000",
			}),
		});

		const result = await handleGetHierarchy({ code: "9901000000" }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity[]>(result);
		expect(data).toHaveLength(2);

		const province = data[0];
		expect(province.income_class).toBe("2nd");
		expect(province.population).toBe(500000);

		const region = data[1];
		expect(region.old_name).toBeNull();
		expect(region.city_class).toBeNull();
		expect(region.parent_code).toBeNull();
	});

	it("list_by_type: old-format entities in type index get null-filled", async () => {
		// type: index now stores pre-hydrated entity arrays
		kv.seed({
			"type:Reg": JSON.stringify([{
				code: "8800000000",
				name: "Legacy Region",
				level: "Reg",
			}]),
		});

		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		const { data } = parseEnvelope<ApiEntity[]>(result);
		const legacy = data.find((e) => e.psgc_code === "8800000000");
		expect(legacy).toBeDefined();
		expect(legacy!.old_name).toBeNull();
		expect(legacy!.population).toBeNull();
		expect(legacy!.parent_code).toBeNull();
		expect(legacy!.child_counts).toBeNull();
	});
});

// ── 6. Strict search edge cases ─────────────────────────────────────

describe("strict search: additional edge cases", () => {
	it("strict + diacritics: 'nono' strict-matches 'Ñoño' (normalized)", async () => {
		const result = await handleSearch(
			{ query: "Ñoño", strict: true },
			kv,
			cache,
			TEST_META,
		);
		const { data } = parseEnvelope<ApiSearchResult[]>(result);
		expect(data.length).toBe(1);
		expect(data[0].name).toBe("Ñoño");
	});

	it("strict + empty query normalized: rejected with no-searchable-chars message", async () => {
		const result = await handleSearch(
			{ query: "", strict: true },
			kv,
			cache,
			TEST_META,
		);
		expect(result.content[0].text).toContain("No searchable characters");
	});

	it("strict + limit: only returns up to limit", async () => {
		// Seed multiple entities with the same normalized name
		kv = buildSeededKV(100);
		cache = { current: null };

		const result = await handleSearch(
			{ query: "Marilao", strict: true, limit: 1 },
			kv,
			cache,
			TEST_META,
		);
		const { data } = parseEnvelope<ApiSearchResult[]>(result);
		expect(data.length).toBe(1);
	});

	it("strict: false (explicit) behaves like default partial matching", async () => {
		const result = await handleSearch(
			{ query: "Mari", strict: false },
			kv,
			cache,
			TEST_META,
		);
		const { data } = parseEnvelope<ApiSearchResult[]>(result);
		expect(data.length).toBeGreaterThan(0);
		expect(data[0].name).toBe("Marilao");
	});

	it("strict with wrong level: no results", async () => {
		const result = await handleSearch(
			{ query: "Marilao", strict: true, level: "City" },
			kv,
			cache,
			TEST_META,
		);
		// Marilao is a Mun, not a City
		expect(result.content[0].text).toContain("No results found");
		expect(result.content[0].text).toContain("at level City");
	});
});

// ── 7. Empty array data responses still wrapped ─────────────────────

describe("empty data arrays are still wrapped (not plain text)", () => {
	it("list_children: empty array wraps with _meta", async () => {
		kv.seed({ "children:0000000000": JSON.stringify([]) });
		const result = await handleListChildren({ code: "0000000000" }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
		expect(envelope.data).toEqual([]);
	});

	it("list_children: level filter produces empty, still wrapped", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Bgy" },
			kv,
			TEST_META,
		);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
		expect(envelope.data).toEqual([]);
	});

	it("list_by_type: empty type array still wrapped", async () => {
		kv.seed({ "type:Reg": JSON.stringify([]) });
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
		expect(envelope.data).toEqual([]);
	});
});
