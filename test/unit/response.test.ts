import { describe, expect, it } from "vitest";
import { toApiEntity, toApiSearchResult, wrapResponse, buildMeta } from "../../src/response";
import type { PSGCEntity } from "../../src/types";
import { MANILA, MIMAROPA } from "../fixtures/entities";
import { TEST_META, TEST_META_CONFIG } from "../fixtures/meta";

describe("toApiEntity", () => {
	it("maps all fields to snake_case", () => {
		const api = toApiEntity(MANILA);
		expect(api.psgc_code).toBe(MANILA.code);
		expect(api.name).toBe(MANILA.name);
		expect(api.level).toBe(MANILA.level);
		expect(api.old_name).toBeNull();
		expect(api.city_class).toBe("HUC");
		expect(api.income_class).toBeNull();
		expect(api.urban_rural).toBeNull();
		expect(api.population).toBe(MANILA.population);
		expect(api.parent_code).toBe(MANILA.parent);
	});

	it("excludes regionCode and provinceCode (internal fields)", () => {
		const api = toApiEntity(MANILA);
		expect(api).not.toHaveProperty("regionCode");
		expect(api).not.toHaveProperty("region_code");
		expect(api).not.toHaveProperty("provinceCode");
		expect(api).not.toHaveProperty("province_code");
	});

	it("null fields stay null", () => {
		const api = toApiEntity(MIMAROPA);
		expect(api.old_name).toBeNull();
		expect(api.city_class).toBeNull();
		expect(api.income_class).toBeNull();
		expect(api.urban_rural).toBeNull();
		expect(api.population).toBeNull();
		expect(api.parent_code).toBeNull();
	});

	it("handles legacy KV data where optional fields are undefined", () => {
		const legacy = {
			code: "0100000000",
			name: "Ilocos Region",
			level: "Reg",
		} as PSGCEntity;
		const api = toApiEntity(legacy);
		expect(api.old_name).toBeNull();
		expect(api.city_class).toBeNull();
		expect(api.population).toBeNull();
		expect(api.parent_code).toBeNull();
	});
});

describe("toApiSearchResult", () => {
	it("maps code to psgc_code", () => {
		const result = toApiSearchResult({ code: "1301006000", name: "City of Manila", level: "City" });
		expect(result.psgc_code).toBe("1301006000");
		expect(result.name).toBe("City of Manila");
		expect(result.level).toBe("City");
	});

	it("does not include extra fields", () => {
		const result = toApiSearchResult({ code: "1301006000", name: "City of Manila", level: "City" });
		expect(Object.keys(result)).toEqual(["psgc_code", "name", "level"]);
	});
});

describe("wrapResponse", () => {
	it("wraps data with _meta", () => {
		const data = { foo: "bar" };
		const wrapped = wrapResponse(data, TEST_META);
		expect(wrapped._meta).toEqual(TEST_META);
		expect(wrapped.data).toEqual(data);
	});

	it("wraps arrays", () => {
		const data = [1, 2, 3];
		const wrapped = wrapResponse(data, TEST_META);
		expect(wrapped.data).toEqual([1, 2, 3]);
	});
});

describe("buildMeta", () => {
	it("produces correct meta from config", () => {
		const meta = buildMeta(TEST_META_CONFIG);
		expect(meta.dataset_version).toBe("PSGC Q4 2025");
		expect(meta.dataset_date).toBe("2025-12-31");
		expect(meta.last_synced).toBe("2026-03-02");
		expect(meta.source).toContain("PSA");
		expect(meta.source_url).toContain("psa.gov.ph");
	});
});
