export type PSGCLevel =
	| "Reg"
	| "Prov"
	| "Dist"
	| "City"
	| "Mun"
	| "SubMun"
	| "SGU"
	| "Bgy";

export interface PSGCEntity {
	code: string;
	name: string;
	level: PSGCLevel;
	oldName: string | null;
	cityClass: string | null;
	incomeClass: string | null;
	urbanRural: string | null;
	population: number | null;
	parent: string | null;
	regionCode: string | null;
	provinceCode: string | null;
	childCounts: Partial<Record<PSGCLevel, number>> | null;
}

export interface SearchIndexEntry {
	/** Normalized name for matching */
	n: string;
	/** Original display name */
	d: string;
	/** 10-digit PSGC code */
	c: string;
	/** Geographic level */
	l: PSGCLevel;
}

export const KV_PREFIX = {
	entity: "entity",
	children: "children",
	type: "type",
	searchIndex: "search:index",
} as const;
