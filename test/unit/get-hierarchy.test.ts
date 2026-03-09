import { describe, expect, it, beforeEach } from "vitest";
import { handleGetHierarchy } from "../../src/tool-handlers";
import {
	buildSeededKV,
	NCR,
	NCR_FIRST_DISTRICT,
	MANILA,
	TONDO,
	BULACAN,
	MARILAO,
	ABANGAN_NORTE,
	CENTRAL_LUZON,
} from "../fixtures/entities";
import type { MockKV } from "../fixtures/mock-kv";
import { TEST_META, parseData } from "../fixtures/meta";
import type { ApiEntity } from "../../src/response";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleGetHierarchy", () => {
	it("returns isError when entity not found", async () => {
		const result = await handleGetHierarchy({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("9999999999");
	});

	it("region: chain is just the region itself", async () => {
		const result = await handleGetHierarchy({ code: NCR.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		expect(chain).toHaveLength(1);
		expect(chain[0].psgc_code).toBe(NCR.code);
	});

	it("province: walks to region via stored parent", async () => {
		const result = await handleGetHierarchy({ code: BULACAN.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		expect(chain.length).toBeGreaterThanOrEqual(2);
		expect(chain[0].psgc_code).toBe(BULACAN.code);
		expect(chain[chain.length - 1].psgc_code).toBe(CENTRAL_LUZON.code);
	});

	it("barangay: full chain Bgy -> Mun -> Prov -> Reg", async () => {
		const result = await handleGetHierarchy({ code: ABANGAN_NORTE.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		const codes = chain.map((e) => e.psgc_code);
		expect(codes[0]).toBe(ABANGAN_NORTE.code);
		expect(codes).toContain(MARILAO.code);
		expect(codes).toContain(BULACAN.code);
		expect(codes).toContain(CENTRAL_LUZON.code);
	});

	it("HUC chain: SubMun -> City -> District -> Region", async () => {
		const result = await handleGetHierarchy({ code: TONDO.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		const codes = chain.map((e) => e.psgc_code);
		expect(codes[0]).toBe(TONDO.code);
		expect(codes).toContain(MANILA.code);
		expect(codes).toContain(NCR_FIRST_DISTRICT.code);
		expect(codes).toContain(NCR.code);
	});

	it("falls back to deriveAncestorCodes when parent chain is incomplete", async () => {
		kv.seed({
			"entity:0314000000": JSON.stringify({
				...BULACAN,
				parent: null,
			}),
		});

		const result = await handleGetHierarchy({ code: BULACAN.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		const codes = chain.map((e) => e.psgc_code);
		expect(codes).toContain(CENTRAL_LUZON.code);
	});

	it("cycle protection: parent pointing to itself does not loop", async () => {
		kv.seed({
			"entity:0314000000": JSON.stringify({
				...BULACAN,
				parent: BULACAN.code,
			}),
		});

		const result = await handleGetHierarchy({ code: BULACAN.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		expect(chain[0].psgc_code).toBe(BULACAN.code);
		expect(chain.length).toBeLessThan(10);
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("two-node mutual cycle: A->B->A terminates via visited set", async () => {
		kv.seed({
			"entity:0000000001": JSON.stringify({
				code: "0000000001",
				name: "Node A",
				level: "Prov",
				parent: "0000000002",
				oldName: null,
				cityClass: null,
				incomeClass: null,
				urbanRural: null,
				population: null,
				regionCode: "0000000000",
				provinceCode: null,
			}),
			"entity:0000000002": JSON.stringify({
				code: "0000000002",
				name: "Node B",
				level: "Prov",
				parent: "0000000001",
				oldName: null,
				cityClass: null,
				incomeClass: null,
				urbanRural: null,
				population: null,
				regionCode: "0000000000",
				provinceCode: null,
			}),
		});

		const result = await handleGetHierarchy({ code: "0000000001" }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		const codes = chain.map((e) => e.psgc_code);
		expect(codes).toContain("0000000001");
		expect(codes).toContain("0000000002");
		expect(chain.length).toBeLessThan(10);
	});

	it("fallback fires but all derived ancestors miss in KV", async () => {
		kv.seed({
			"entity:9800000000": JSON.stringify({
				code: "9800000000",
				name: "Orphan Region-like",
				level: "Prov",
				oldName: null,
				cityClass: null,
				incomeClass: null,
				urbanRural: null,
				population: null,
				parent: null,
				regionCode: "9800000000",
				provinceCode: null,
			}),
		});

		const result = await handleGetHierarchy({ code: "9800000000" }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		expect(chain).toHaveLength(1);
		expect(chain[0].psgc_code).toBe("9800000000");
		expect(result.isError).toBeUndefined();
	});

	it("includes warning when parent data is corrupt", async () => {
		kv.setRaw(`entity:${CENTRAL_LUZON.code}`, "corrupt!!!");
		const result = await handleGetHierarchy({ code: BULACAN.code }, kv, TEST_META);
		const text = result.content[0].text;
		const parsed = JSON.parse(text);
		expect(parsed.warning).toContain("incomplete");
		// Chain still includes Bulacan itself
		expect(parsed.data[0].psgc_code).toBe(BULACAN.code);
	});

	it("parent chain stops at non-Reg entity, fallback adds region", async () => {
		kv.seed({
			"entity:0314000000": JSON.stringify({
				...BULACAN,
				parent: null,
			}),
		});

		const result = await handleGetHierarchy({ code: MARILAO.code }, kv, TEST_META);
		const chain = parseData<ApiEntity[]>(result);
		const codes = chain.map((e) => e.psgc_code);
		expect(codes[0]).toBe(MARILAO.code);
		expect(codes).toContain(BULACAN.code);
		expect(codes).toContain(CENTRAL_LUZON.code);
	});
});
