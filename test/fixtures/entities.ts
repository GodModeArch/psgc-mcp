import type { PSGCEntity, PSGCLevel, SearchIndexEntry } from "../../src/types";
import { KV_PREFIX } from "../../src/types";
import { normalize } from "../../src/utils";
import { MockKV } from "./mock-kv";

// ── Canonical PSGC fixture entities ──────────────────────────────────

export const NCR: PSGCEntity = {
	code: "1300000000",
	name: "National Capital Region",
	level: "Reg",
	population: 13484462,
	regionCode: "1300000000",
};

export const CENTRAL_LUZON: PSGCEntity = {
	code: "0300000000",
	name: "Central Luzon",
	level: "Reg",
	population: 12422172,
	regionCode: "0300000000",
};

export const MIMAROPA: PSGCEntity = {
	code: "1700000000",
	name: "MIMAROPA Region",
	level: "Reg",
	regionCode: "1700000000",
};

export const NCR_FIRST_DISTRICT: PSGCEntity = {
	code: "1301000000",
	name: "NCR, First District",
	level: "Dist",
	parent: "1300000000",
	regionCode: "1300000000",
};

export const BULACAN: PSGCEntity = {
	code: "0314000000",
	name: "Bulacan",
	level: "Prov",
	parent: "0300000000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	incomeClass: "1st",
};

export const MANILA: PSGCEntity = {
	code: "1301006000",
	name: "City of Manila",
	level: "City",
	cityClass: "HUC",
	parent: "1301000000",
	regionCode: "1300000000",
	provinceCode: "1301000000",
	population: 1846513,
};

export const QUEZON_CITY: PSGCEntity = {
	code: "1307404000",
	name: "Quezon City",
	level: "City",
	cityClass: "HUC",
	parent: "1300000000",
	regionCode: "1300000000",
	provinceCode: "1307000000",
	population: 2960048,
};

export const MALOLOS: PSGCEntity = {
	code: "0314009000",
	name: "City of Malolos",
	level: "City",
	cityClass: "CC",
	parent: "0314000000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
};

export const MARILAO: PSGCEntity = {
	code: "0314024000",
	name: "Marilao",
	level: "Mun",
	parent: "0314000000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	population: 234572,
};

export const TONDO: PSGCEntity = {
	code: "1301006001",
	name: "Tondo I/II",
	level: "SubMun",
	parent: "1301006000",
	regionCode: "1300000000",
	provinceCode: "1301000000",
};

export const KALAYAAN: PSGCEntity = {
	code: "9900100000",
	name: "Kalayaan Islands",
	level: "SGU",
	parent: "1700000000",
	regionCode: "9900000000",
};

export const ABANGAN_NORTE: PSGCEntity = {
	code: "0314024001",
	name: "Abangan Norte",
	level: "Bgy",
	parent: "0314024000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	urbanRural: "Urban",
};

// ── Entity with Ñ for diacritic testing ──────────────────────────────

export const NONO_BGY: PSGCEntity = {
	code: "0314024099",
	name: "Ñoño",
	level: "Bgy",
	parent: "0314024000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
};

// ── Fake barangays under Marilao (for batch testing) ────────────────

export function generateMarilaoBarangays(count: number): PSGCEntity[] {
	const bgys: PSGCEntity[] = [];
	for (let i = 2; i <= count + 1; i++) {
		const suffix = String(i).padStart(3, "0");
		bgys.push({
			code: `0314024${suffix}`,
			name: `Barangay ${suffix}`,
			level: "Bgy",
			parent: "0314024000",
			regionCode: "0300000000",
			provinceCode: "0314000000",
		});
	}
	return bgys;
}

// ── All named entities in a flat array ──────────────────────────────

export const ALL_NAMED_ENTITIES: PSGCEntity[] = [
	NCR,
	CENTRAL_LUZON,
	MIMAROPA,
	NCR_FIRST_DISTRICT,
	BULACAN,
	MANILA,
	QUEZON_CITY,
	MALOLOS,
	MARILAO,
	TONDO,
	KALAYAAN,
	ABANGAN_NORTE,
	NONO_BGY,
];

// ── Build a fully seeded MockKV ─────────────────────────────────────

export function buildSeededKV(extraBarangays = 0): MockKV {
	const kv = new MockKV();
	const entities = [...ALL_NAMED_ENTITIES, ...generateMarilaoBarangays(extraBarangays)];

	// Seed entity records
	const kvData: Record<string, unknown> = {};
	for (const e of entities) {
		kvData[`${KV_PREFIX.entity}:${e.code}`] = e;
	}

	// Build children index
	const childrenMap = new Map<string, string[]>();
	for (const e of entities) {
		if (e.parent) {
			const list = childrenMap.get(e.parent) ?? [];
			list.push(e.code);
			childrenMap.set(e.parent, list);
		}
	}
	for (const [parentCode, codes] of childrenMap) {
		kvData[`${KV_PREFIX.children}:${parentCode}`] = codes.sort();
	}

	// Build type index (skip Bgy per production behavior)
	const typeMap = new Map<PSGCLevel, string[]>();
	for (const e of entities) {
		if (e.level === "Bgy") continue;
		const list = typeMap.get(e.level) ?? [];
		list.push(e.code);
		typeMap.set(e.level, list);
	}
	for (const [level, codes] of typeMap) {
		kvData[`${KV_PREFIX.type}:${level}`] = codes.sort();
	}

	// Build search index
	const searchIndex: SearchIndexEntry[] = entities.map((e) => ({
		n: normalize(e.name),
		d: e.name,
		c: e.code,
		l: e.level,
	}));
	kvData[KV_PREFIX.searchIndex] = searchIndex;

	kv.seed(kvData);
	return kv;
}
