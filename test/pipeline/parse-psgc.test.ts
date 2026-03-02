import { describe, expect, it } from "vitest";
import { parseLevel, padCode, LEVEL_MAP, resolveParents } from "../../scripts/parse-psgc";
import type { PSGCEntity } from "../../src/types";

// ── parseLevel ─────────────────────────────────────────────────────

describe("parseLevel", () => {
	it("maps 'Reg' to 'Reg'", () => {
		expect(parseLevel("Reg")).toBe("Reg");
	});

	it("maps 'Sub-Mun' to 'SubMun'", () => {
		expect(parseLevel("Sub-Mun")).toBe("SubMun");
	});

	it("maps 'SubMun' to 'SubMun'", () => {
		expect(parseLevel("SubMun")).toBe("SubMun");
	});

	it("trims whitespace: ' City ' -> 'City'", () => {
		expect(parseLevel(" City ")).toBe("City");
	});

	it("returns null for unknown level", () => {
		expect(parseLevel("Village")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseLevel("")).toBeNull();
	});

	it("returns null for whitespace-only", () => {
		expect(parseLevel("   ")).toBeNull();
	});

	it("all LEVEL_MAP keys are recognized", () => {
		for (const key of Object.keys(LEVEL_MAP)) {
			expect(parseLevel(key)).toBe(LEVEL_MAP[key]);
		}
	});

	it("is case-sensitive: lowercase 'reg' returns null", () => {
		expect(parseLevel("reg")).toBeNull();
	});

	it("is case-sensitive: lowercase 'bgy' returns null", () => {
		expect(parseLevel("bgy")).toBeNull();
	});

	it("'Sub Mun' (space, no hyphen) returns null", () => {
		expect(parseLevel("Sub Mun")).toBeNull();
	});

	it("null input returns null via optional chaining", () => {
		expect(parseLevel(null as unknown as string)).toBeNull();
	});

	it("undefined input returns null via optional chaining", () => {
		expect(parseLevel(undefined as unknown as string)).toBeNull();
	});
});

// ── padCode ────────────────────────────────────────────────────────

describe("padCode", () => {
	it("leaves 10-digit code unchanged", () => {
		expect(padCode("0314024001")).toBe("0314024001");
	});

	it("pads short codes with leading zeros", () => {
		expect(padCode("314024001")).toBe("0314024001");
	});

	it("strips non-digit characters", () => {
		expect(padCode("03-14-024-001")).toBe("0314024001");
	});

	it("handles numeric input", () => {
		expect(padCode(314024001)).toBe("0314024001");
	});

	it("pads very short input", () => {
		expect(padCode("1")).toBe("0000000001");
	});

	it("handles empty string (all zeros)", () => {
		expect(padCode("")).toBe("0000000000");
	});

	it("code longer than 10 digits is returned as-is (no truncation)", () => {
		// padStart does nothing when string is already longer than target
		expect(padCode("031402400199")).toBe("031402400199");
		expect(padCode("031402400199").length).toBe(12);
	});

	it("numeric zero produces all zeros", () => {
		expect(padCode(0)).toBe("0000000000");
	});

	it("large number beyond safe integer produces wrong code via scientific notation", () => {
		// 10^17 = 100000000000000000 -> String() = "100000000000000000" (18 digits)
		// But 10^20 -> "100000000000000000000" still works because it's within BigInt string range
		// The truly dangerous case: 99999999999999999 (17 nines) is beyond Number.MAX_SAFE_INTEGER
		// String(99999999999999999) = "100000000000000000" due to float rounding
		const result = padCode(99999999999999999);
		// Not "99999999999999999" -- demonstrates silent data corruption
		expect(result).not.toBe("99999999999999999");
	});

	it("floating point input strips decimal point", () => {
		// String(3.14) = "3.14", strip non-digits = "314", pad to 10
		expect(padCode(3.14)).toBe("0000000314");
	});
});

// ── resolveParents ─────────────────────────────────────────────────

describe("resolveParents", () => {
	function makeEntity(
		code: string,
		level: PSGCEntity["level"],
	): PSGCEntity {
		return {
			code,
			name: `Entity ${code}`,
			level,
			oldName: null,
			cityClass: null,
			incomeClass: null,
			urbanRural: null,
			population: null,
			parent: null,
			regionCode: null,
			provinceCode: null,
		};
	}

	it("assigns province parent to its region", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("0300000000", makeEntity("0300000000", "Reg"));
		entities.set("0314000000", makeEntity("0314000000", "Prov"));

		resolveParents(entities);

		expect(entities.get("0314000000")!.parent).toBe("0300000000");
	});

	it("does not assign parent to regions", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("0300000000", makeEntity("0300000000", "Reg"));

		resolveParents(entities);

		expect(entities.get("0300000000")!.parent).toBeNull();
	});

	it("HUC falls back to district when province code doesn't exist", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("1300000000", makeEntity("1300000000", "Reg"));
		entities.set("1301000000", makeEntity("1301000000", "Dist"));
		// City of Manila (1301006000): deriveParentCode gives 1301000000 (province slot)
		// But 1301000000 exists as Dist, so it should use the district
		entities.set("1301006000", makeEntity("1301006000", "City"));

		resolveParents(entities);

		// deriveParentCode for City = slice(0,4)+"000000" = "1301000000"
		// That exists and is a Dist, so parent = "1301000000"
		expect(entities.get("1301006000")!.parent).toBe("1301000000");
	});

	it("HUC falls back to region when no province and no district exist", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("1300000000", makeEntity("1300000000", "Reg"));
		// HUC city where derived province (1307000000) doesn't exist
		entities.set("1307404000", makeEntity("1307404000", "City"));

		resolveParents(entities);

		expect(entities.get("1307404000")!.parent).toBe("1300000000");
	});

	it("HUC uses district fallback via region scan", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("1300000000", makeEntity("1300000000", "Reg"));
		// A district with matching first 2 + province digits
		entities.set("1307000000", makeEntity("1307000000", "Dist"));
		// City whose derived province (1307000000) is actually a district
		entities.set("1307404000", makeEntity("1307404000", "City"));

		resolveParents(entities);

		// deriveParentCode gives "1307000000" which exists as "Dist"
		expect(entities.get("1307404000")!.parent).toBe("1307000000");
	});

	it("non-city/mun entity falls back to region when derived parent missing", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("9900000000", makeEntity("9900000000", "Reg"));
		entities.set("9900100000", makeEntity("9900100000", "SGU"));

		resolveParents(entities);

		expect(entities.get("9900100000")!.parent).toBe("9900000000");
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("empty map does not throw", () => {
		const entities = new Map<string, PSGCEntity>();
		expect(() => resolveParents(entities)).not.toThrow();
	});

	it("Mun with missing province falls back to region (same as City)", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("1300000000", makeEntity("1300000000", "Reg"));
		// Mun where derived province (1307000000) doesn't exist and no district
		entities.set("1307404000", makeEntity("1307404000", "Mun"));

		resolveParents(entities);

		expect(entities.get("1307404000")!.parent).toBe("1300000000");
	});

	it("Prov with no region in map still assigns region code as parent", () => {
		// Parent points to a non-existent entity
		const entities = new Map<string, PSGCEntity>();
		entities.set("0314000000", makeEntity("0314000000", "Prov"));

		resolveParents(entities);

		// deriveParentCode gives "0300000000" which doesn't exist
		// Falls to else branch (not City/Mun), assigns region code anyway
		expect(entities.get("0314000000")!.parent).toBe("0300000000");
	});

	it("SubMun with missing city falls back to region (not city-level scan)", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("1300000000", makeEntity("1300000000", "Reg"));
		// SubMun whose derived city (1301000000) doesn't exist
		entities.set("1301006001", makeEntity("1301006001", "SubMun"));

		resolveParents(entities);

		// SubMun is not City/Mun, so it takes the generic fallback to region
		expect(entities.get("1301006001")!.parent).toBe("1300000000");
	});

	it("Mun with missing province uses district scan and finds match", () => {
		const entities = new Map<string, PSGCEntity>();
		entities.set("1300000000", makeEntity("1300000000", "Reg"));
		// District in same region with matching province digits
		entities.set("1307000000", makeEntity("1307000000", "Dist"));
		// Municipality whose derived province doesn't exist
		entities.set("1307505000", makeEntity("1307505000", "Mun"));

		resolveParents(entities);

		// Derived parent "1307000000" exists as Dist -> assigned
		expect(entities.get("1307505000")!.parent).toBe("1307000000");
	});
});
