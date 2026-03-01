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
import type { PSGCEntity } from "../../src/types";

let kv: MockKV;

beforeEach(() => {
	kv = buildSeededKV();
});

describe("handleGetHierarchy", () => {
	it("returns isError when entity not found", async () => {
		const result = await handleGetHierarchy({ code: "9999999999" }, kv);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("9999999999");
	});

	it("region: chain is just the region itself", async () => {
		const result = await handleGetHierarchy({ code: NCR.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(chain).toHaveLength(1);
		expect(chain[0].code).toBe(NCR.code);
	});

	it("province: walks to region via stored parent", async () => {
		const result = await handleGetHierarchy({ code: BULACAN.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(chain.length).toBeGreaterThanOrEqual(2);
		expect(chain[0].code).toBe(BULACAN.code);
		expect(chain[chain.length - 1].code).toBe(CENTRAL_LUZON.code);
	});

	it("barangay: full chain Bgy -> Mun -> Prov -> Reg", async () => {
		const result = await handleGetHierarchy({ code: ABANGAN_NORTE.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = chain.map((e) => e.code);
		expect(codes[0]).toBe(ABANGAN_NORTE.code);
		expect(codes).toContain(MARILAO.code);
		expect(codes).toContain(BULACAN.code);
		expect(codes).toContain(CENTRAL_LUZON.code);
	});

	it("HUC chain: SubMun -> City -> District -> Region", async () => {
		const result = await handleGetHierarchy({ code: TONDO.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = chain.map((e) => e.code);
		expect(codes[0]).toBe(TONDO.code);
		expect(codes).toContain(MANILA.code);
		expect(codes).toContain(NCR_FIRST_DISTRICT.code);
		expect(codes).toContain(NCR.code);
	});

	it("falls back to deriveAncestorCodes when parent chain is incomplete", async () => {
		// Remove Bulacan's parent link so the chain stops at province
		kv.seed({
			"entity:0314000000": JSON.stringify({
				...BULACAN,
				parent: undefined,
			}),
		});

		const result = await handleGetHierarchy({ code: BULACAN.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = chain.map((e) => e.code);
		// deriveAncestorCodes for 0314000000 gives ["0300000000"]
		expect(codes).toContain(CENTRAL_LUZON.code);
	});

	it("cycle protection: parent pointing to itself does not loop", async () => {
		kv.seed({
			"entity:0314000000": JSON.stringify({
				...BULACAN,
				parent: BULACAN.code,
			}),
		});

		const result = await handleGetHierarchy({ code: BULACAN.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		expect(chain[0].code).toBe(BULACAN.code);
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
			}),
			"entity:0000000002": JSON.stringify({
				code: "0000000002",
				name: "Node B",
				level: "Prov",
				parent: "0000000001",
			}),
		});

		const result = await handleGetHierarchy({ code: "0000000001" }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = chain.map((e) => e.code);
		// Should have A and B, then stop (B.parent = A which is visited)
		expect(codes).toContain("0000000001");
		expect(codes).toContain("0000000002");
		// Neither is Reg, so fallback fires, but derived ancestors (0000000000)
		// likely don't exist. Chain should be finite.
		expect(chain.length).toBeLessThan(10);
	});

	it("fallback fires but all derived ancestors miss in KV", async () => {
		// Entity with no parent, no ancestors in KV
		kv.seed({
			"entity:9800000000": JSON.stringify({
				code: "9800000000",
				name: "Orphan Region-like",
				level: "Prov",
			}),
		});

		const result = await handleGetHierarchy({ code: "9800000000" }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		// Chain is just the entity itself, no error
		expect(chain).toHaveLength(1);
		expect(chain[0].code).toBe("9800000000");
		expect(result.isError).toBeUndefined();
	});

	it("parent chain stops at non-Reg entity, fallback adds region", async () => {
		// Marilao -> Bulacan (Prov, chain doesn't reach Reg by stored parents alone
		// if we break Bulacan's parent). Fallback should add Central Luzon.
		kv.seed({
			"entity:0314000000": JSON.stringify({
				...BULACAN,
				parent: undefined,
			}),
		});

		const result = await handleGetHierarchy({ code: MARILAO.code }, kv);
		const chain: PSGCEntity[] = JSON.parse(result.content[0].text);
		const codes = chain.map((e) => e.code);
		expect(codes[0]).toBe(MARILAO.code);
		expect(codes).toContain(BULACAN.code);
		// Fallback should derive and add Central Luzon
		expect(codes).toContain(CENTRAL_LUZON.code);
	});
});
