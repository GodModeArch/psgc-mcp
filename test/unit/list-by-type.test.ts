import { describe, expect, it, beforeEach } from "vitest";
import { handleListByType } from "../../src/tool-handlers";
import { buildSeededKV, NCR, CENTRAL_LUZON, MIMAROPA, KALAYAAN } from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import type { PSGCEntity } from "../../src/types";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleListByType", () => {
	it("returns entities for valid level (Reg)", async () => {
		const result = await handleListByType({ level: "Reg" }, kv);
		expect(result.isError).toBeUndefined();
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = entities.map((e) => e.code);
		expect(codes).toContain(NCR.code);
		expect(codes).toContain(CENTRAL_LUZON.code);
		expect(codes).toContain(MIMAROPA.code);
	});

	it("returns entities for Prov level", async () => {
		const result = await handleListByType({ level: "Prov" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities.length).toBeGreaterThan(0);
		for (const e of entities) {
			expect(e.level).toBe("Prov");
		}
	});

	it("returns isError for missing type index (Bgy not indexed)", async () => {
		// Bgy is excluded from type index in production
		const result = await handleListByType({ level: "Bgy" as "Reg" }, kv);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No type index found");
	});

	it("silently skips missing entity records in type index", async () => {
		// Seed a type index that includes a non-existent code
		kv.seed({
			"type:Reg": JSON.stringify([NCR.code, "9999999999"]),
		});

		const result = await handleListByType({ level: "Reg" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities).toHaveLength(1);
		expect(entities[0].code).toBe(NCR.code);
	});

	it("handles 101 codes in type index (2 batches)", async () => {
		const codes: string[] = [];
		for (let i = 0; i < 101; i++) {
			const code = `${String(i).padStart(2, "0")}00000000`;
			codes.push(code);
			kv.seed({
				[`entity:${code}`]: JSON.stringify({
					code,
					name: `Region ${i}`,
					level: "Reg",
				}),
			});
		}
		kv.seed({ "type:Reg": JSON.stringify(codes) });

		const result = await handleListByType({ level: "Reg" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities).toHaveLength(101);
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("empty type array in KV returns empty JSON array (not isError)", async () => {
		// Key exists but value is "[]"
		kv.seed({ "type:Reg": JSON.stringify([]) });

		const result = await handleListByType({ level: "Reg" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities).toEqual([]);
		expect(result.isError).toBeUndefined();
	});

	it("SGU level returns Kalayaan", async () => {
		const result = await handleListByType({ level: "SGU" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(entities.length).toBeGreaterThan(0);
		expect(entities.map((e) => e.code)).toContain(KALAYAAN.code);
	});

	it("City level returns all cities from fixture data", async () => {
		const result = await handleListByType({ level: "City" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		for (const e of entities) {
			expect(e.level).toBe("City");
		}
		expect(entities.length).toBeGreaterThanOrEqual(3); // Manila, QC, Malolos
	});

	it("SubMun level returns sub-municipalities", async () => {
		const result = await handleListByType({ level: "SubMun" }, kv);
		const entities: PSGCEntity[] = JSON.parse(result.content[0].text);
		for (const e of entities) {
			expect(e.level).toBe("SubMun");
		}
	});
});
