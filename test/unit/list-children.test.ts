import { describe, expect, it, beforeEach } from "vitest";
import { handleListChildren } from "../../src/tool-handlers";
import {
	buildSeededKV,
	BULACAN,
	MARILAO,
	MALOLOS,
	ABANGAN_NORTE,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parseData } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleListChildren", () => {
	it("returns informational message when no children key exists", async () => {
		const result = await handleListChildren({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("No children found");
	});

	it("returns child entities for a parent", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const entities = parseData<ApiEntity[]>(result);
		const codes = entities.map((e) => e.psgc_code);
		expect(codes).toContain(MALOLOS.code);
		expect(codes).toContain(MARILAO.code);
	});

	it("level filter returns only matching children", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Mun" },
			kv,
			TEST_META,
		);
		const entities = parseData<ApiEntity[]>(result);
		for (const e of entities) {
			expect(e.level).toBe("Mun");
		}
		expect(entities.map((e) => e.psgc_code)).toContain(MARILAO.code);
		expect(entities.map((e) => e.psgc_code)).not.toContain(MALOLOS.code);
	});

	it("silently skips missing child entities", async () => {
		kv.seed({
			"children:0000000000": JSON.stringify(["9999999999", ABANGAN_NORTE.code]),
		});

		const result = await handleListChildren({ code: "0000000000" }, kv, TEST_META);
		const entities = parseData<ApiEntity[]>(result);
		expect(entities).toHaveLength(1);
		expect(entities[0].psgc_code).toBe(ABANGAN_NORTE.code);
	});

	it("101 children triggers 2 batches, all returned", async () => {
		kv = buildSeededKV(100);
		const result = await handleListChildren({ code: MARILAO.code }, kv, TEST_META);
		const entities = parseData<ApiEntity[]>(result);
		// Abangan Norte + Nono + 100 generated = 102 children
		expect(entities.length).toBe(102);
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("empty children array in KV returns empty JSON array (not 'no children' message)", async () => {
		kv.seed({ "children:0000000000": JSON.stringify([]) });

		const result = await handleListChildren({ code: "0000000000" }, kv, TEST_META);
		const entities = parseData<ApiEntity[]>(result);
		expect(entities).toEqual([]);
		expect(result.content[0].text).not.toContain("No children found");
	});

	it("level filter that matches no children returns empty array", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Bgy" },
			kv,
			TEST_META,
		);
		const entities = parseData<ApiEntity[]>(result);
		expect(entities).toEqual([]);
	});

	it("duplicate codes in children index produces duplicate entities", async () => {
		kv.seed({
			"children:0000000000": JSON.stringify([
				ABANGAN_NORTE.code,
				ABANGAN_NORTE.code,
			]),
		});

		const result = await handleListChildren({ code: "0000000000" }, kv, TEST_META);
		const entities = parseData<ApiEntity[]>(result);
		expect(entities).toHaveLength(2);
		expect(entities[0].psgc_code).toBe(ABANGAN_NORTE.code);
		expect(entities[1].psgc_code).toBe(ABANGAN_NORTE.code);
	});
});
