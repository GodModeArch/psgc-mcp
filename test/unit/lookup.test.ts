import { describe, expect, it, beforeEach } from "vitest";
import { handleLookup } from "../../src/tool-handlers";
import { buildSeededKV, MANILA, ABANGAN_NORTE } from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parseData, parseEnvelope } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleLookup", () => {
	it("returns parsed entity when found", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv, TEST_META);
		expect(result.isError).toBeUndefined();
		const entity = parseData<ApiEntity>(result);
		expect(entity.psgc_code).toBe(MANILA.code);
		expect(entity.name).toBe(MANILA.name);
		expect(entity.level).toBe(MANILA.level);
		expect(entity.city_class).toBe("HUC");
		expect(entity.population).toBe(MANILA.population);
	});

	it("returns isError when not found", async () => {
		const result = await handleLookup({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("9999999999");
	});

	it("returns entity with null for absent optional fields", async () => {
		const result = await handleLookup({ code: ABANGAN_NORTE.code }, kv, TEST_META);
		const entity = parseData<ApiEntity>(result);
		expect(entity.psgc_code).toBe(ABANGAN_NORTE.code);
		expect(entity.name).toBe(ABANGAN_NORTE.name);
		expect(entity.level).toBe("Bgy");
		expect(entity.urban_rural).toBe("Urban");
		expect(entity.city_class).toBeNull();
	});

	it("returns entity with parent_code and excludes internal fields", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv, TEST_META);
		const entity = parseData<ApiEntity>(result);
		expect(entity.parent_code).toBe(MANILA.parent);
		expect(entity).not.toHaveProperty("regionCode");
		expect(entity).not.toHaveProperty("provinceCode");
	});

	it("wraps response with _meta", async () => {
		const result = await handleLookup({ code: MANILA.code }, kv, TEST_META);
		const envelope = parseEnvelope<ApiEntity>(result);
		expect(envelope._meta).toEqual(TEST_META);
		expect(envelope.data.psgc_code).toBe(MANILA.code);
	});
});
