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
import type { PSGCEntity } from "../../src/types";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleListChildren", () => {
	it("returns informational message when no children key exists", async () => {
		const result = await handleListChildren({ code: "9999999999" }, kv);
		// Not an error (isError should be undefined), just informational
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("No children found");
	});

	it("returns child entities for a parent", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = entities.map((e) => e.code);
		expect(codes).toContain(MALOLOS.code);
		expect(codes).toContain(MARILAO.code);
	});

	it("level filter returns only matching children", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Mun" },
			kv,
		);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		for (const e of entities) {
			expect(e.level).toBe("Mun");
		}
		expect(entities.map((e) => e.code)).toContain(MARILAO.code);
		expect(entities.map((e) => e.code)).not.toContain(MALOLOS.code);
	});

	it("silently skips missing child entities", async () => {
		// Seed children index with a code that has no entity record
		kv.seed({
			"children:0000000000": JSON.stringify(["9999999999", ABANGAN_NORTE.code]),
		});

		const result = await handleListChildren({ code: "0000000000" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		// Only the existing entity should be returned
		expect(entities).toHaveLength(1);
		expect(entities[0].code).toBe(ABANGAN_NORTE.code);
	});

	it("101 children triggers 2 batches, all returned", async () => {
		// Generate 100 extra barangays under Marilao (+ Abangan Norte + Nono = 102 children)
		kv = buildSeededKV(100);
		const result = await handleListChildren({ code: MARILAO.code }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		// Abangan Norte + Nono + 100 generated = 102 children
		expect(entities.length).toBe(102);
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("empty children array in KV returns empty JSON array (not 'no children' message)", async () => {
		// Key exists but value is "[]" -- different response shape than missing key
		kv.seed({ "children:0000000000": JSON.stringify([]) });

		const result = await handleListChildren({ code: "0000000000" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities).toEqual([]);
		// Notably does NOT contain the "No children found" message
		expect(result.content[0].text).not.toContain("No children found");
	});

	it("level filter that matches no children returns empty array", async () => {
		// Bulacan's children are City and Mun, filtering by Bgy should return []
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Bgy" },
			kv,
		);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities).toEqual([]);
	});

	it("duplicate codes in children index produces duplicate entities", async () => {
		kv.seed({
			"children:0000000000": JSON.stringify([
				ABANGAN_NORTE.code,
				ABANGAN_NORTE.code,
			]),
		});

		const result = await handleListChildren({ code: "0000000000" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		// No dedup -- both fetches resolve the same entity
		expect(entities).toHaveLength(2);
		expect(entities[0].code).toBe(ABANGAN_NORTE.code);
		expect(entities[1].code).toBe(ABANGAN_NORTE.code);
	});
});
