import type { PSGCEntity, PSGCLevel, SearchIndexEntry } from "./types";
import { KV_PREFIX } from "./types";
import { normalize, deriveAncestorCodes } from "./utils";
import type { ApiMeta } from "./response";
import { toApiEntity, toApiSearchResult, wrapResponse } from "./response";

/** Minimal KV interface for dependency injection (subset of KVNamespace) */
export interface KVGet {
	get(key: string): Promise<string | null>;
}

/** Injectable search index cache reference */
export interface SearchCache {
	current: SearchIndexEntry[] | null;
}

/** Standard MCP tool return shape (index signature required by MCP SDK) */
export interface ToolResult {
	[key: string]: unknown;
	content: { type: "text"; text: string }[];
	isError?: boolean;
}

// ── Tool 1: lookup ─────────────────────────────────────────────────

export async function handleLookup(
	args: { code: string },
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	const raw = await kv.get(`${KV_PREFIX.entity}:${args.code}`);
	if (!raw) {
		return {
			content: [
				{ type: "text", text: `No entity found for PSGC code ${args.code}` },
			],
			isError: true,
		};
	}

	const entity: PSGCEntity = JSON.parse(raw);
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(wrapResponse(toApiEntity(entity), meta), null, 2),
			},
		],
	};
}

// ── Tool 2: search ─────────────────────────────────────────────────

export async function handleSearch(
	args: { query: string; level?: PSGCLevel; limit?: number; strict?: boolean },
	kv: KVGet,
	cache: SearchCache,
	meta: ApiMeta,
): Promise<ToolResult> {
	if (!cache.current) {
		const raw = await kv.get(KV_PREFIX.searchIndex);
		if (!raw) {
			return {
				content: [
					{
						type: "text",
						text: "Search index not found. Data may not be loaded yet.",
					},
				],
				isError: true,
			};
		}
		cache.current = JSON.parse(raw);
	}

	const normalizedQuery = normalize(args.query);
	const maxResults = args.limit ?? 10;
	const strict = args.strict ?? false;

	type ScoredEntry = SearchIndexEntry & { score: number };
	const matches: ScoredEntry[] = [];

	for (const entry of cache.current!) {
		if (args.level && entry.l !== args.level) continue;

		if (strict) {
			if (entry.n !== normalizedQuery) continue;
			matches.push({ ...entry, score: 3 });
		} else {
			if (!entry.n.includes(normalizedQuery)) continue;

			let score = 0;
			if (entry.n === normalizedQuery) {
				score = 3;
			} else if (entry.n.startsWith(normalizedQuery)) {
				score = 2;
			} else {
				score = 1;
			}

			matches.push({ ...entry, score });
		}
	}

	matches.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return a.n.localeCompare(b.n);
	});

	const results = matches.slice(0, maxResults).map((m) => ({
		code: m.c,
		name: m.d,
		level: m.l,
	}));

	if (results.length === 0) {
		return {
			content: [
				{
					type: "text",
					text: `No results found for "${args.query}"${args.level ? ` at level ${args.level}` : ""}`,
				},
			],
		};
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapResponse(results.map(toApiSearchResult), meta),
					null,
					2,
				),
			},
		],
	};
}

// ── Tool 3: get_hierarchy ──────────────────────────────────────────

export async function handleGetHierarchy(
	args: { code: string },
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	const entityRaw = await kv.get(`${KV_PREFIX.entity}:${args.code}`);
	if (!entityRaw) {
		return {
			content: [
				{
					type: "text",
					text: `No entity found for PSGC code ${args.code}`,
				},
			],
			isError: true,
		};
	}

	const entity: PSGCEntity = JSON.parse(entityRaw);
	const chain: PSGCEntity[] = [entity];

	let current = entity;
	const visited = new Set<string>([args.code]);

	while (current.parent && !visited.has(current.parent)) {
		visited.add(current.parent);
		const parentRaw = await kv.get(
			`${KV_PREFIX.entity}:${current.parent}`,
		);
		if (!parentRaw) break;

		const parent: PSGCEntity = JSON.parse(parentRaw);
		chain.push(parent);
		current = parent;
	}

	if (chain.length === 1 || chain[chain.length - 1].level !== "Reg") {
		const ancestorCodes = deriveAncestorCodes(args.code);
		const fetches = ancestorCodes
			.filter((c) => !visited.has(c))
			.map(async (c) => {
				const raw = await kv.get(`${KV_PREFIX.entity}:${c}`);
				return raw ? (JSON.parse(raw) as PSGCEntity) : null;
			});

		const ancestors = await Promise.all(fetches);
		for (const a of ancestors) {
			if (a && !visited.has(a.code)) {
				visited.add(a.code);
				chain.push(a);
			}
		}
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapResponse(chain.map(toApiEntity), meta),
					null,
					2,
				),
			},
		],
	};
}

// ── Tool 4: list_children ──────────────────────────────────────────

export async function handleListChildren(
	args: { code: string; level?: PSGCLevel },
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	const childrenRaw = await kv.get(`${KV_PREFIX.children}:${args.code}`);
	if (!childrenRaw) {
		return {
			content: [
				{
					type: "text",
					text: `No children found for PSGC code ${args.code}. It may be a barangay (leaf level) or the code may be invalid.`,
				},
			],
		};
	}

	const childCodes: string[] = JSON.parse(childrenRaw);

	const entities: PSGCEntity[] = [];
	for (let i = 0; i < childCodes.length; i += 100) {
		const batch = childCodes.slice(i, i + 100);
		const fetches = batch.map(async (c) => {
			const raw = await kv.get(`${KV_PREFIX.entity}:${c}`);
			return raw ? (JSON.parse(raw) as PSGCEntity) : null;
		});
		const results = await Promise.all(fetches);
		for (const r of results) {
			if (r && (!args.level || r.level === args.level)) {
				entities.push(r);
			}
		}
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapResponse(entities.map(toApiEntity), meta),
					null,
					2,
				),
			},
		],
	};
}

// ── Tool 5: list_by_type ───────────────────────────────────────────

export async function handleListByType(
	args: { level: PSGCLevel },
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	const codesRaw = await kv.get(`${KV_PREFIX.type}:${args.level}`);
	if (!codesRaw) {
		return {
			content: [
				{
					type: "text",
					text: `No type index found for level ${args.level}. Data may not be loaded yet.`,
				},
			],
			isError: true,
		};
	}

	const codes: string[] = JSON.parse(codesRaw);

	const entities: PSGCEntity[] = [];
	for (let i = 0; i < codes.length; i += 100) {
		const batch = codes.slice(i, i + 100);
		const fetches = batch.map(async (c) => {
			const raw = await kv.get(`${KV_PREFIX.entity}:${c}`);
			return raw ? (JSON.parse(raw) as PSGCEntity) : null;
		});
		const results = await Promise.all(fetches);
		for (const r of results) {
			if (r) entities.push(r);
		}
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapResponse(entities.map(toApiEntity), meta),
					null,
					2,
				),
			},
		],
	};
}
