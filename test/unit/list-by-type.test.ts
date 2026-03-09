import { describe, expect, it, beforeEach } from "vitest";
import { handleListByType } from "../../src/tool-handlers";
import {
	buildSeededKV,
	NCR,
	CENTRAL_LUZON,
	MIMAROPA,
	BULACAN,
	KALAYAAN,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parsePaginated } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleListByType", () => {
	it("returns entities with pagination metadata for valid level (Reg)", async () => {
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		expect(result.isError).toBeUndefined();
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		const codes = data.map((e) => e.psgc_code);
		expect(codes).toContain(NCR.code);
		expect(codes).toContain(CENTRAL_LUZON.code);
		expect(codes).toContain(MIMAROPA.code);
		expect(pagination.total_count).toBe(3);
	});

	it("returns isError for missing type index (Bgy not indexed)", async () => {
		const result = await handleListByType({ level: "Bgy" as "Reg" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No type index found");
	});

	it("pagination offset and limit work correctly", async () => {
		const result = await handleListByType(
			{ level: "Reg", offset: 1, limit: 1 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(1);
		expect(pagination.total_count).toBe(3);
		expect(pagination.offset).toBe(1);
		expect(pagination.limit).toBe(1);
		expect(pagination.has_more).toBe(true);
	});

	it("entities include child_counts", async () => {
		const result = await handleListByType({ level: "Prov" }, kv, TEST_META);
		const { data } = parsePaginated<ApiEntity[]>(result);
		const bulacan = data.find((e) => e.psgc_code === BULACAN.code);
		expect(bulacan).toBeDefined();
		expect(bulacan!.child_counts).toEqual({ City: 1, Mun: 1, Bgy: 2 });
	});

	it("empty type array returns empty data with pagination", async () => {
		kv.seed({ "type:Reg": JSON.stringify([]) });

		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toEqual([]);
		expect(pagination.total_count).toBe(0);
		expect(pagination.has_more).toBe(false);
		expect(result.isError).toBeUndefined();
	});

	it("SGU level returns Kalayaan", async () => {
		const result = await handleListByType({ level: "SGU" }, kv, TEST_META);
		const { data } = parsePaginated<ApiEntity[]>(result);
		expect(data.length).toBeGreaterThan(0);
		expect(data.map((e) => e.psgc_code)).toContain(KALAYAAN.code);
	});

	it("default limit is 50", async () => {
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		const { pagination } = parsePaginated<ApiEntity[]>(result);
		expect(pagination.limit).toBe(50);
	});

	it("returns isError on corrupt KV data instead of crashing", async () => {
		kv.setRaw("type:Reg", "not json!!!");
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Corrupt data");
	});
});
