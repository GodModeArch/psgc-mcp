import type { PSGCLevel } from "./types";

/**
 * Normalize a string for search matching.
 * Lowercase, strip diacritics, replace non-alphanum with space, collapse whitespace.
 */
export function normalize(str: string): string {
	return str
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Derive the direct parent PSGC code from a code and its level.
 * Returns undefined for regions (no parent).
 *
 * PSGC code structure (10 digits):
 *   RR PP CC BBB S
 *   Region(2) Province(2) CityMun(2) Barangay(3) Suffix(1)
 */
export function deriveParentCode(
	code: string,
	level: PSGCLevel,
): string | undefined {
	switch (level) {
		case "Reg":
			return undefined;

		case "Prov":
		case "Dist":
			// Parent is region: first 2 digits + 8 zeros
			return code.slice(0, 2) + "00000000";

		case "City":
		case "Mun":
			// Parent is province: first 4 digits + 6 zeros
			// Note: HUC/ICC parents get corrected in a second pass by the parser
			return code.slice(0, 4) + "000000";

		case "SubMun":
			// Parent is city: first 6 digits + 4 zeros
			return code.slice(0, 6) + "0000";

		case "SGU":
			// Special geographic units belong to region
			return code.slice(0, 2) + "00000000";

		case "Bgy":
			// Parent is city/mun: first 6 digits + 4 zeros
			return code.slice(0, 6) + "0000";

		default:
			return undefined;
	}
}

/**
 * Derive all ancestor codes from a PSGC code, ordered child-to-root.
 * Stops at the region level (does not include the entity itself).
 */
export function deriveAncestorCodes(code: string): string[] {
	const ancestors: string[] = [];

	// City/Mun/SubMun/Bgy parent (digits 1-6 + 0000)
	const cityMunCode = code.slice(0, 6) + "0000";
	if (cityMunCode !== code && cityMunCode !== code.slice(0, 2) + "00000000") {
		// Only add if it's a real intermediate level (not the region itself)
		const hasCityMunDigits = code.slice(4, 6) !== "00";
		if (hasCityMunDigits) {
			ancestors.push(cityMunCode);
		}
	}

	// Province parent (digits 1-4 + 000000)
	const provCode = code.slice(0, 4) + "000000";
	if (provCode !== code && provCode !== code.slice(0, 2) + "00000000") {
		const hasProvDigits = code.slice(2, 4) !== "00";
		if (hasProvDigits) {
			ancestors.push(provCode);
		}
	}

	// Region (digits 1-2 + 00000000)
	const regCode = code.slice(0, 2) + "00000000";
	if (regCode !== code) {
		ancestors.push(regCode);
	}

	return ancestors;
}
