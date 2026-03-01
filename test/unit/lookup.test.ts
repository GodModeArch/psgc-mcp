import { describe, expect, it, beforeEach } from "vitest";
import { handleLookup } from "../../src/tool-handlers";
import { buildSeededKV, MANILA, ABANGAN_NORTE } from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleLookup", () => {
	it("returns parsed entity when found", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv);
		expect(result.isError).toBeUndefined();
		const entity = JSON.parse(result.content[0].text);
		expect(entity.code).toBe(MANILA.code);
		expect(entity.name).toBe(MANILA.name);
		expect(entity.level).toBe(MANILA.level);
		expect(entity.cityClass).toBe("HUC");
		expect(entity.population).toBe(MANILA.population);
	});

	it("returns isError when not found", async () => {
		const result = await handleLookup({ code: "9999999999" }, kv);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("9999999999");
	});

	it("returns entity with only required fields", async () => {
		// ABANGAN_NORTE has urbanRural but no cityClass, incomeClass, population, oldName
		const result = await handleLookup({ code: ABANGAN_NORTE.code }, kv);
		const entity = JSON.parse(result.content[0].text);
		expect(entity.code).toBe(ABANGAN_NORTE.code);
		expect(entity.name).toBe(ABANGAN_NORTE.name);
		expect(entity.level).toBe("Bgy");
		expect(entity.urbanRural).toBe("Urban");
		expect(entity.cityClass).toBeUndefined();
	});

	it("returns entity with all optional fields present", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv);
		const entity = JSON.parse(result.content[0].text);
		expect(entity.parent).toBe(MANILA.parent);
		expect(entity.regionCode).toBe(MANILA.regionCode);
		expect(entity.provinceCode).toBe(MANILA.provinceCode);
	});
});
