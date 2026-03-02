import type { PSGCEntity, PSGCLevel } from "./types";

/** Snake_case entity for API responses. Internal fields (regionCode, provinceCode) excluded. */
export interface ApiEntity {
	psgc_code: string;
	name: string;
	level: PSGCLevel;
	old_name: string | null;
	city_class: string | null;
	income_class: string | null;
	urban_rural: string | null;
	population: number | null;
	parent_code: string | null;
}

/** Lightweight search result for API responses. */
export interface ApiSearchResult {
	psgc_code: string;
	name: string;
	level: PSGCLevel;
}

/** Response metadata for provenance. */
export interface ApiMeta {
	dataset_version: string;
	dataset_date: string;
	last_synced: string;
	source: string;
	source_url: string;
}

/** Config for building metadata from environment variables. */
export interface MetaConfig {
	datasetVersion: string;
	datasetDate: string;
	lastSynced: string;
}

const PSA_SOURCE = "Philippine Statistics Authority (PSA)";
const PSA_URL = "https://psa.gov.ph/classification/psgc/";

export function buildMeta(config: MetaConfig): ApiMeta {
	return {
		dataset_version: config.datasetVersion,
		dataset_date: config.datasetDate,
		last_synced: config.lastSynced,
		source: PSA_SOURCE,
		source_url: PSA_URL,
	};
}

/** Transform internal PSGCEntity to snake_case API entity. Uses ?? null for KV backward compat. */
export function toApiEntity(entity: PSGCEntity): ApiEntity {
	return {
		psgc_code: entity.code,
		name: entity.name,
		level: entity.level,
		old_name: entity.oldName ?? null,
		city_class: entity.cityClass ?? null,
		income_class: entity.incomeClass ?? null,
		urban_rural: entity.urbanRural ?? null,
		population: entity.population ?? null,
		parent_code: entity.parent ?? null,
	};
}

/** Transform a search hit to a lightweight API search result. */
export function toApiSearchResult(hit: {
	code: string;
	name: string;
	level: PSGCLevel;
}): ApiSearchResult {
	return {
		psgc_code: hit.code,
		name: hit.name,
		level: hit.level,
	};
}

/** Wrap data with metadata envelope. */
export function wrapResponse<T>(data: T, meta: ApiMeta): { _meta: ApiMeta; data: T } {
	return { _meta: meta, data };
}
