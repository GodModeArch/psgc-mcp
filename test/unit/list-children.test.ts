import { describe, expect, it, beforeEach } from "vitest";
import { handleListChildren } from "../../src/tool-handlers";
import {
	buildSeededKV,
	BULACAN,
	MARILAO,
	MALOLOS,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parsePaginated } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleListChildren", () => {
	it("returns error when no children key exists", async () => {
		const result = await handleListChildren({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No children found");
	});

	it("returns direct child entities with pagination metadata", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		const codes = data.map((e) => e.psgc_code);
		expect(codes).toContain(MALOLOS.code);
		expect(codes).toContain(MARILAO.code);
		expect(pagination.total_count).toBe(2);
		expect(pagination.has_more).toBe(false);
	});

	it("level filter applies before pagination", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Mun" },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(1);
		expect(data[0].psgc_code).toBe(MARILAO.code);
		expect(pagination.total_count).toBe(1);
	});

	it("offset skips records", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, offset: 1 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(1);
		expect(pagination.total_count).toBe(2);
		expect(pagination.offset).toBe(1);
	});

	it("limit caps results and sets has_more", async () => {
		kv = buildSeededKV(100);
		const result = await handleListChildren(
			{ code: MARILAO.code, limit: 10 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(10);
		expect(pagination.total_count).toBe(102);
		expect(pagination.has_more).toBe(true);
	});

	it("default limit is 50", async () => {
		kv = buildSeededKV(100);
		const result = await handleListChildren(
			{ code: MARILAO.code },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(50);
		expect(pagination.limit).toBe(50);
		expect(pagination.has_more).toBe(true);
	});

	it("empty children array returns empty data with pagination", async () => {
		kv.seed({ "children:0000000000": JSON.stringify([]) });

		const result = await handleListChildren({ code: "0000000000" }, kv, TEST_META);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toEqual([]);
		expect(pagination.total_count).toBe(0);
		expect(pagination.has_more).toBe(false);
	});

	it("child entities include child_counts", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const { data } = parsePaginated<ApiEntity[]>(result);
		const marilao = data.find((e) => e.psgc_code === MARILAO.code);
		expect(marilao).toBeDefined();
		expect(marilao!.child_counts).toEqual({ Bgy: 2 });
	});

	it("returns isError on corrupt KV data instead of crashing", async () => {
		kv.setRaw(`children:${BULACAN.code}`, "{broken json");
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Corrupt data");
	});
});
