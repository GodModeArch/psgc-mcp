import type { ApiMeta, MetaConfig } from "../../src/response";
import { buildMeta } from "../../src/response";

export const TEST_META_CONFIG: MetaConfig = {
	datasetVersion: "PSGC Q4 2025",
	datasetDate: "2025-12-31",
	lastSynced: "2026-03-02",
};

export const TEST_META: ApiMeta = buildMeta(TEST_META_CONFIG);

/** Parse a wrapped response, returning the `data` property typed as T. */
export function parseData<T>(result: { content: { type: string; text: string }[] }): T {
	const envelope = JSON.parse(result.content[0].text);
	return envelope.data as T;
}

/** Parse a wrapped response and return the full envelope including _meta. */
export function parseEnvelope<T>(
	result: { content: { type: string; text: string }[] },
): { _meta: ApiMeta; data: T } {
	return JSON.parse(result.content[0].text);
}
