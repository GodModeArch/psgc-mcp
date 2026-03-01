import { describe, expect, it } from "vitest";
import { normalize, deriveParentCode, deriveAncestorCodes } from "../../src/utils";
import type { PSGCLevel } from "../../src/types";

// ── normalize ──────────────────────────────────────────────────────

describe("normalize", () => {
	it("lowercases and trims", () => {
		expect(normalize("  MANILA  ")).toBe("manila");
	});

	it("strips diacritics", () => {
		expect(normalize("Ñoño")).toBe("nono");
	});

	it("replaces punctuation with space", () => {
		expect(normalize("City of Manila (NCR)")).toBe("city of manila ncr");
	});

	it("collapses multiple spaces", () => {
		expect(normalize("San   Jose   del   Monte")).toBe("san jose del monte");
	});

	it("returns empty string for empty input", () => {
		expect(normalize("")).toBe("");
	});

	it("handles numbers mixed with text", () => {
		expect(normalize("District 1")).toBe("district 1");
	});

	it("handles pure punctuation", () => {
		expect(normalize("---")).toBe("");
	});

	it("whitespace-only input returns empty string", () => {
		expect(normalize("   ")).toBe("");
	});

	it("unicode beyond diacritics is stripped to spaces", () => {
		// Emoji and CJK are non-alphanumeric, replaced with space then trimmed
		expect(normalize("San José 🏙")).toBe("san jose");
	});
});

// ── deriveParentCode ───────────────────────────────────────────────

describe("deriveParentCode", () => {
	it("Reg -> undefined (no parent)", () => {
		expect(deriveParentCode("1300000000", "Reg")).toBeUndefined();
	});

	it("Prov -> region code", () => {
		expect(deriveParentCode("0314000000", "Prov")).toBe("0300000000");
	});

	it("Dist -> region code", () => {
		expect(deriveParentCode("1301000000", "Dist")).toBe("1300000000");
	});

	it("City -> province code (before HUC correction)", () => {
		expect(deriveParentCode("0314009000", "City")).toBe("0314000000");
	});

	it("Mun -> province code", () => {
		expect(deriveParentCode("0314024000", "Mun")).toBe("0314000000");
	});

	it("SubMun -> first 6 digits + 0000", () => {
		// slice(0,6) = "130100" -> "1301000000" (positional, not semantic parent)
		expect(deriveParentCode("1301006001", "SubMun")).toBe("1301000000");
	});

	it("SGU -> region code", () => {
		expect(deriveParentCode("9900100000", "SGU")).toBe("9900000000");
	});

	it("Bgy -> first 6 digits + 0000", () => {
		// slice(0,6) = "031402" -> "0314020000" (positional, corrected by parse pipeline)
		expect(deriveParentCode("0314024001", "Bgy")).toBe("0314020000");
	});

	it("unknown level -> undefined", () => {
		expect(deriveParentCode("0000000000", "Unknown" as PSGCLevel)).toBeUndefined();
	});

	it("all-zeros code for Prov returns self (degenerate case)", () => {
		// slice(0,2) = "00" -> "0000000000" which equals input
		expect(deriveParentCode("0000000000", "Prov")).toBe("0000000000");
	});

	it("short code produces truncated parent (no length validation)", () => {
		// slice(0,4) on "13" gives "13", + "000000" = "13000000" (8 chars)
		expect(deriveParentCode("13", "City")).toBe("13000000");
	});

	it("SGU with province digits still derives region", () => {
		// Ensures SGU always goes to region regardless of province-slot content
		expect(deriveParentCode("9914100000", "SGU")).toBe("9900000000");
	});
});

// ── deriveAncestorCodes ────────────────────────────────────────────
// Note: this function uses positional slicing (RR PP CC BBBB) and may produce
// codes that don't match real entities. The hierarchy handler uses stored parent
// chains first, falling back to these derived codes only when needed.

describe("deriveAncestorCodes", () => {
	it("region -> empty array", () => {
		expect(deriveAncestorCodes("1300000000")).toEqual([]);
	});

	it("province -> [region]", () => {
		expect(deriveAncestorCodes("0314000000")).toEqual(["0300000000"]);
	});

	it("district -> [region]", () => {
		// 1301000000: cityMun and prov codes both equal the code itself, only region added
		expect(deriveAncestorCodes("1301000000")).toEqual(["1300000000"]);
	});

	it("city (under province, digits 4-5 are 00) -> [province, region]", () => {
		// 0314009000: slice(4,6)="00" so cityMun skipped, provCode=0314000000
		expect(deriveAncestorCodes("0314009000")).toEqual([
			"0314000000",
			"0300000000",
		]);
	});

	it("municipality -> [derived cityMun, province, region]", () => {
		// 0314024000: slice(0,6)="031402" -> cityMunCode=0314020000, slice(4,6)="02"
		expect(deriveAncestorCodes("0314024000")).toEqual([
			"0314020000",
			"0314000000",
			"0300000000",
		]);
	});

	it("barangay -> [derived cityMun, province, region]", () => {
		// 0314024001: slice(0,6)="031402" -> cityMunCode=0314020000
		expect(deriveAncestorCodes("0314024001")).toEqual([
			"0314020000",
			"0314000000",
			"0300000000",
		]);
	});

	it("NCR sub-municipality -> [district, region]", () => {
		// 1301006001: slice(4,6)="00" so cityMun skipped, provCode=1301000000
		expect(deriveAncestorCodes("1301006001")).toEqual([
			"1301000000",
			"1300000000",
		]);
	});

	it("HUC (Quezon City) -> [derived cityMun, district-level, region]", () => {
		// 1307404000: slice(0,6)="130740" -> 1307400000, slice(4,6)="40"
		// provCode=1307000000, slice(2,4)="07"
		expect(deriveAncestorCodes("1307404000")).toEqual([
			"1307400000",
			"1307000000",
			"1300000000",
		]);
	});

	it("all-zeros code returns empty array (same as region)", () => {
		expect(deriveAncestorCodes("0000000000")).toEqual([]);
	});

	it("code with zero province but non-zero cityMun skips province, includes cityMun", () => {
		// "1300041000": provCode "1300000000" === regCode so province is skipped
		// cityMun "1300040000" is added (slice(4,6)="04")
		expect(deriveAncestorCodes("1300041000")).toEqual([
			"1300040000",
			"1300000000",
		]);
	});
});
