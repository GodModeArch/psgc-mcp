import type { PSGCEntity, PSGCLevel, SearchIndexEntry } from "../../src/types";
import { KV_PREFIX } from "../../src/types";
import { normalize } from "../../src/utils";
import { MockKV } from "./mock-kv";

// ── Canonical PSGC fixture entities ──────────────────────────────────

export const NCR: PSGCEntity = {
	code: "1300000000",
	name: "National Capital Region",
	level: "Reg",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: 13484462,
	parent: null,
	regionCode: "1300000000",
	provinceCode: null,
	childCounts: { Dist: 1, City: 2, SubMun: 1 },
};

export const CENTRAL_LUZON: PSGCEntity = {
	code: "0300000000",
	name: "Central Luzon",
	level: "Reg",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: 12422172,
	parent: null,
	regionCode: "0300000000",
	provinceCode: null,
	childCounts: { Prov: 1, City: 1, Mun: 1, Bgy: 2 },
};

export const MIMAROPA: PSGCEntity = {
	code: "1700000000",
	name: "MIMAROPA Region",
	level: "Reg",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: null,
	parent: null,
	regionCode: "1700000000",
	provinceCode: null,
	childCounts: { SGU: 1 },
};

export const NCR_FIRST_DISTRICT: PSGCEntity = {
	code: "1301000000",
	name: "NCR, First District",
	level: "Dist",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: null,
	parent: "1300000000",
	regionCode: "1300000000",
	provinceCode: null,
	childCounts: { City: 1, SubMun: 1 },
};

export const BULACAN: PSGCEntity = {
	code: "0314000000",
	name: "Bulacan",
	level: "Prov",
	oldName: null,
	cityClass: null,
	incomeClass: "1st",
	urbanRural: null,
	population: 3708890,
	parent: "0300000000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	childCounts: { City: 1, Mun: 1, Bgy: 2 },
};

export const MANILA: PSGCEntity = {
	code: "1301006000",
	name: "City of Manila",
	level: "City",
	oldName: null,
	cityClass: "HUC",
	incomeClass: null,
	urbanRural: null,
	population: 1846513,
	parent: "1301000000",
	regionCode: "1300000000",
	provinceCode: "1301000000",
	childCounts: { SubMun: 1 },
};

export const QUEZON_CITY: PSGCEntity = {
	code: "1307404000",
	name: "Quezon City",
	level: "City",
	oldName: null,
	cityClass: "HUC",
	incomeClass: null,
	urbanRural: null,
	population: 2960048,
	parent: "1300000000",
	regionCode: "1300000000",
	provinceCode: "1307000000",
	childCounts: null,
};

export const MALOLOS: PSGCEntity = {
	code: "0314009000",
	name: "City of Malolos",
	level: "City",
	oldName: null,
	cityClass: "CC",
	incomeClass: null,
	urbanRural: null,
	population: 252164,
	parent: "0314000000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	childCounts: null,
};

export const MARILAO: PSGCEntity = {
	code: "0314024000",
	name: "Marilao",
	level: "Mun",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: 234572,
	parent: "0314000000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	childCounts: { Bgy: 2 },
};

export const TONDO: PSGCEntity = {
	code: "1301006001",
	name: "Tondo I/II",
	level: "SubMun",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: null,
	parent: "1301006000",
	regionCode: "1300000000",
	provinceCode: "1301000000",
	childCounts: null,
};

export const KALAYAAN: PSGCEntity = {
	code: "9900100000",
	name: "Kalayaan Islands",
	level: "SGU",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: null,
	parent: "1700000000",
	regionCode: "9900000000",
	provinceCode: null,
	childCounts: null,
};

export const ABANGAN_NORTE: PSGCEntity = {
	code: "0314024001",
	name: "Abangan Norte",
	level: "Bgy",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: "Urban",
	population: 15238,
	parent: "0314024000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	childCounts: null,
};

// ── Entity with Ñ for diacritic testing ──────────────────────────────

export const NONO_BGY: PSGCEntity = {
	code: "0314024099",
	name: "Ñoño",
	level: "Bgy",
	oldName: null,
	cityClass: null,
	incomeClass: null,
	urbanRural: null,
	population: null,
	parent: "0314024000",
	regionCode: "0300000000",
	provinceCode: "0314000000",
	childCounts: null,
};

// ── Fake barangays under Marilao (for batch testing) ────────────────

export function generateMarilaoBarangays(count: number): PSGCEntity[] {
	const bgys: PSGCEntity[] = [];
	// Start at 200 to avoid collision with NONO_BGY fixture (0314024099)
	for (let i = 0; i < count; i++) {
		const suffix = String(200 + i).padStart(3, "0");
		bgys.push({
			code: `0314024${suffix}`,
			name: `Barangay ${suffix}`,
			level: "Bgy",
			oldName: null,
			cityClass: null,
			incomeClass: null,
			urbanRural: null,
			population: 1000 + i,
			parent: "0314024000",
			regionCode: "0300000000",
			provinceCode: "0314000000",
			childCounts: null,
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

	// Build children index (pre-hydrated entity arrays)
	const childrenMap = new Map<string, PSGCEntity[]>();
	for (const e of entities) {
		if (e.parent) {
			const list = childrenMap.get(e.parent) ?? [];
			list.push(e);
			childrenMap.set(e.parent, list);
		}
	}
	for (const [parentCode, children] of childrenMap) {
		children.sort((a, b) => a.code.localeCompare(b.code));
		kvData[`${KV_PREFIX.children}:${parentCode}`] = children;
	}

	// Build type index (pre-hydrated entity arrays, skip Bgy per production behavior)
	const typeMap = new Map<PSGCLevel, PSGCEntity[]>();
	for (const e of entities) {
		if (e.level === "Bgy") continue;
		const list = typeMap.get(e.level) ?? [];
		list.push(e);
		typeMap.set(e.level, list);
	}
	for (const [level, levelEntities] of typeMap) {
		levelEntities.sort((a, b) => a.code.localeCompare(b.code));
		kvData[`${KV_PREFIX.type}:${level}`] = levelEntities;
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
