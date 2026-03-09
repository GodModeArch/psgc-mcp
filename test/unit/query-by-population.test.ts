import { describe, expect, it, beforeEach } from "vitest";
import { handleQueryByPopulation } from "../../src/tool-handlers";
import {
	buildSeededKV,
	NCR,
	CENTRAL_LUZON,
	MANILA,
	QUEZON_CITY,
	MALOLOS,
	MARILAO,
	BULACAN,
	ABANGAN_NORTE,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parsePaginated, parseEnvelope } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleQueryByPopulation", () => {
	// ── Sorting ───────────────────────────────────────────────────

	it("returns cities sorted by population descending (default)", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City" },
			kv,
			TEST_META,
		);
		expect(result.isError).toBeUndefined();

		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data.length).toBeGreaterThan(0);

		// All results should have population (nulls excluded)
		for (const r of data) {
			expect(r.population).not.toBeNull();
		}

		// Verify descending order
		for (let i = 1; i < data.length; i++) {
			expect(data[i - 1].population!).toBeGreaterThanOrEqual(
				data[i].population!,
			);
		}
	});

	it("sorts ascending when sort=asc", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City", sort: "asc" },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		for (let i = 1; i < data.length; i++) {
			expect(data[i - 1].population!).toBeLessThanOrEqual(
				data[i].population!,
			);
		}
	});

	// ── Population range filtering ────────────────────────────────

	it("filters by min_population", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City", min_population: 1000000 },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		for (const r of data) {
			expect(r.population!).toBeGreaterThanOrEqual(1000000);
		}
		// Should include QC (2.9M) and Manila (1.8M) but not Malolos (252K)
		const codes = data.map((r) => r.psgc_code);
		expect(codes).toContain(QUEZON_CITY.code);
		expect(codes).toContain(MANILA.code);
		expect(codes).not.toContain(MALOLOS.code);
	});

	it("filters by max_population", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City", max_population: 500000 },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		for (const r of data) {
			expect(r.population!).toBeLessThanOrEqual(500000);
		}
	});

	it("filters by min and max population range", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City", min_population: 200000, max_population: 300000 },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		for (const r of data) {
			expect(r.population!).toBeGreaterThanOrEqual(200000);
			expect(r.population!).toBeLessThanOrEqual(300000);
		}
		// Malolos (252K) should be in range
		expect(data.map((r) => r.psgc_code)).toContain(MALOLOS.code);
	});

	// ── Null population exclusion ─────────────────────────────────

	it("excludes entities with null population", async () => {
		const result = await handleQueryByPopulation(
			{ level: "Reg" },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		// MIMAROPA has null population and should be excluded
		const codes = data.map((r) => r.psgc_code);
		expect(codes).not.toContain("1700000000");

		for (const r of data) {
			expect(r.population).not.toBeNull();
		}
	});

	// ── Parent code prefix filtering ──────────────────────────────

	it("filters by parent_code prefix for non-Bgy levels", async () => {
		// Central Luzon = 0300000000, prefix = "03"
		const result = await handleQueryByPopulation(
			{ level: "City", parent_code: CENTRAL_LUZON.code },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		// Should include Malolos (03*) but not Manila or QC (13*)
		for (const r of data) {
			expect(r.psgc_code.startsWith("03")).toBe(true);
		}
	});

	// ── Barangay queries ──────────────────────────────────────────

	it("returns error for Bgy without parent_code", async () => {
		const result = await handleQueryByPopulation(
			{ level: "Bgy" },
			kv,
			TEST_META,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("parent_code is required");
	});

	it("returns barangays scoped to parent_code", async () => {
		const result = await handleQueryByPopulation(
			{ level: "Bgy", parent_code: MARILAO.code },
			kv,
			TEST_META,
		);
		const { data } = parsePaginated<ApiEntity[]>(result);

		// Abangan Norte (15,238) should be present
		expect(data.map((r) => r.psgc_code)).toContain(
			ABANGAN_NORTE.code,
		);

		for (const r of data) {
			expect(r.level).toBe("Bgy");
			expect(r.population).not.toBeNull();
		}
	});

	// ── Validation ────────────────────────────────────────────────

	it("returns error when min > max population", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City", min_population: 500000, max_population: 100000 },
			kv,
			TEST_META,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("cannot exceed");
	});

	// ── Limit and pagination ──────────────────────────────────────

	it("respects limit and reports total_count in pagination", async () => {
		const result = await handleQueryByPopulation(
			{ level: "Reg", limit: 1 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);

		expect(data).toHaveLength(1);
		// There are 2 regions with population (NCR, Central Luzon)
		expect(pagination.total_count).toBeGreaterThanOrEqual(2);
		expect(pagination.has_more).toBe(true);
	});

	// ── Error branches ───────────────────────────────────────────

	it("returns error when type index is missing for non-Bgy level", async () => {
		kv.delete("type:City");
		const result = await handleQueryByPopulation(
			{ level: "City" },
			kv,
			TEST_META,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No type index found");
	});

	it("returns error when children index is missing for Bgy with parent_code", async () => {
		const result = await handleQueryByPopulation(
			{ level: "Bgy", parent_code: "9999999999" },
			kv,
			TEST_META,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No children found");
	});

	it("caps limit at 100 even when higher value is passed", async () => {
		kv = buildSeededKV(150); // 150 extra bgys + Abangan Norte = 151 bgys with population
		const result = await handleQueryByPopulation(
			{ level: "Bgy", parent_code: MARILAO.code, limit: 200 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);

		// 150 generated (with population) + Abangan Norte = 151; Nono has null population so filtered
		expect(pagination.total_count).toBe(151);
		expect(data).toHaveLength(100);
		expect(pagination.has_more).toBe(true);
	});

	it("returns error when min_population exceeds max_population", async () => {
		const result = await handleQueryByPopulation(
			{ level: "City", min_population: 500000, max_population: 100000 },
			kv,
			TEST_META,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("cannot exceed");
	});

	// ── Metadata ──────────────────────────────────────────────────

	it("wraps response with _meta", async () => {
		const result = await handleQueryByPopulation(
			{ level: "Reg" },
			kv,
			TEST_META,
		);
		const envelope = parseEnvelope<ApiEntity[]>(result);
		expect(envelope._meta).toEqual(TEST_META);
	});
});
