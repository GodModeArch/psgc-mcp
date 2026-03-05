import { describe, expect, it, beforeEach } from "vitest";
import { handleBatchLookup } from "../../src/tool-handlers";
import {
	buildSeededKV,
	MANILA,
	QUEZON_CITY,
	BULACAN,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parseData, parseEnvelope } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

interface BatchResult {
	results: (ApiEntity | null)[];
	found: number;
	not_found: number;
	total: number;
}

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleBatchLookup", () => {
	it("returns all entities in input order", async () => {
		const codes = [MANILA.code, QUEZON_CITY.code, BULACAN.code];
		const result = await handleBatchLookup({ codes }, kv, TEST_META);
		expect(result.isError).toBeUndefined();

		const data = parseData<BatchResult>(result);
		expect(data.results).toHaveLength(3);
		expect(data.results[0]!.psgc_code).toBe(MANILA.code);
		expect(data.results[1]!.psgc_code).toBe(QUEZON_CITY.code);
		expect(data.results[2]!.psgc_code).toBe(BULACAN.code);
		expect(data.found).toBe(3);
		expect(data.not_found).toBe(0);
		expect(data.total).toBe(3);
	});

	it("returns null for unknown codes at correct position", async () => {
		const codes = [MANILA.code, "9999999999", BULACAN.code];
		const result = await handleBatchLookup({ codes }, kv, TEST_META);

		const data = parseData<BatchResult>(result);
		expect(data.results[0]!.psgc_code).toBe(MANILA.code);
		expect(data.results[1]).toBeNull();
		expect(data.results[2]!.psgc_code).toBe(BULACAN.code);
		expect(data.found).toBe(2);
		expect(data.not_found).toBe(1);
	});

	it("returns all nulls for entirely unknown codes", async () => {
		const codes = ["9999999999", "8888888888"];
		const result = await handleBatchLookup({ codes }, kv, TEST_META);

		const data = parseData<BatchResult>(result);
		expect(data.results).toEqual([null, null]);
		expect(data.found).toBe(0);
		expect(data.not_found).toBe(2);
	});

	it("returns error for empty array", async () => {
		const result = await handleBatchLookup({ codes: [] }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("empty");
	});

	it("returns error for over 50 codes", async () => {
		const codes = Array.from({ length: 51 }, (_, i) =>
			String(i).padStart(10, "0"),
		);
		const result = await handleBatchLookup({ codes }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("50");
	});

	it("wraps response with _meta", async () => {
		const result = await handleBatchLookup(
			{ codes: [MANILA.code] },
			kv,
			TEST_META,
		);
		const envelope = parseEnvelope<BatchResult>(result);
		expect(envelope._meta).toEqual(TEST_META);
		expect(envelope.data.results).toHaveLength(1);
	});

	it("returns full entity data including population", async () => {
		const result = await handleBatchLookup(
			{ codes: [MANILA.code] },
			kv,
			TEST_META,
		);
		const data = parseData<BatchResult>(result);
		expect(data.results[0]!.population).toBe(MANILA.population);
		expect(data.results[0]!.city_class).toBe("HUC");
	});
});
