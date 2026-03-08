import type { PSGCEntity, PSGCLevel, SearchIndexEntry } from "./types";
import { KV_PREFIX } from "./types";
import { normalize, deriveAncestorCodes } from "./utils";
import type { ApiMeta } from "./response";
import { toApiEntity, toApiSearchResult, wrapResponse, wrapPaginatedResponse } from "./response";

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
	args: { code: string; level?: PSGCLevel; offset?: number; limit?: number },
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

	let children: PSGCEntity[] = JSON.parse(childrenRaw);

	// Apply level filter before pagination
	if (args.level) {
		children = children.filter((c) => c.level === args.level);
	}

	const totalCount = children.length;
	const offset = args.offset ?? 0;
	const limit = Math.min(args.limit ?? 50, 200);
	const page = children.slice(offset, offset + limit);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapPaginatedResponse(page.map(toApiEntity), meta, {
						total_count: totalCount,
						offset,
						limit,
						has_more: offset + limit < totalCount,
					}),
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

// ── Tool 6: batch_lookup ──────────────────────────────────────────

export async function handleBatchLookup(
	args: { codes: string[] },
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	if (args.codes.length === 0) {
		return {
			content: [{ type: "text", text: "codes array must not be empty." }],
			isError: true,
		};
	}

	if (args.codes.length > 50) {
		return {
			content: [
				{
					type: "text",
					text: `codes array exceeds maximum of 50 (received ${args.codes.length}).`,
				},
			],
			isError: true,
		};
	}

	const raws = await Promise.all(
		args.codes.map((c) => kv.get(`${KV_PREFIX.entity}:${c}`)),
	);

	const results = raws.map((raw) =>
		raw ? toApiEntity(JSON.parse(raw) as PSGCEntity) : null,
	);

	const found = results.filter((r) => r !== null).length;
	const notFound = results.length - found;

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapResponse({ results, found, not_found: notFound, total: results.length }, meta),
					null,
					2,
				),
			},
		],
	};
}

// ── Tool 7: query_by_population ───────────────────────────────────

export async function handleQueryByPopulation(
	args: {
		level: PSGCLevel;
		parent_code?: string;
		min_population?: number;
		max_population?: number;
		sort?: "asc" | "desc";
		limit?: number;
	},
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	const {
		level,
		parent_code,
		min_population,
		max_population,
		sort = "desc",
		limit = 10,
	} = args;

	// Validation
	if (
		min_population !== undefined &&
		max_population !== undefined &&
		min_population > max_population
	) {
		return {
			content: [
				{
					type: "text",
					text: `min_population (${min_population}) cannot exceed max_population (${max_population}).`,
				},
			],
			isError: true,
		};
	}

	if (level === "Bgy" && !parent_code) {
		return {
			content: [
				{
					type: "text",
					text: "parent_code is required when querying barangays (Bgy) by population. There are 42,000+ barangays; narrow the scope with a parent city/municipality code.",
				},
			],
			isError: true,
		};
	}

	// Get candidate codes
	let codesRaw: string | null;
	if (level === "Bgy") {
		codesRaw = await kv.get(`${KV_PREFIX.children}:${parent_code}`);
	} else {
		codesRaw = await kv.get(`${KV_PREFIX.type}:${level}`);
	}

	if (!codesRaw) {
		return {
			content: [
				{
					type: "text",
					text:
						level === "Bgy"
							? `No children found for parent code ${parent_code}.`
							: `No type index found for level ${level}. Data may not be loaded yet.`,
				},
			],
			isError: true,
		};
	}

	const codes: string[] = JSON.parse(codesRaw);

	// Derive parent prefix for filtering (strip trailing zeros)
	const parentPrefix = parent_code
		? parent_code.replace(/0+$/, "")
		: undefined;

	// Fetch entities in batches of 100 and filter
	const matching: PSGCEntity[] = [];
	for (let i = 0; i < codes.length; i += 100) {
		const batch = codes.slice(i, i + 100);
		const fetches = batch.map(async (c) => {
			const raw = await kv.get(`${KV_PREFIX.entity}:${c}`);
			return raw ? (JSON.parse(raw) as PSGCEntity) : null;
		});
		const results = await Promise.all(fetches);
		for (const entity of results) {
			if (!entity) continue;
			if (entity.level !== level) continue;
			if (entity.population === null) continue;
			if (parentPrefix && level !== "Bgy" && !entity.code.startsWith(parentPrefix)) continue;
			if (min_population !== undefined && entity.population < min_population) continue;
			if (max_population !== undefined && entity.population > max_population) continue;
			matching.push(entity);
		}
	}

	// Sort by population
	matching.sort((a, b) =>
		sort === "asc"
			? (a.population ?? 0) - (b.population ?? 0)
			: (b.population ?? 0) - (a.population ?? 0),
	);

	const totalMatching = matching.length;
	const effectiveLimit = Math.min(limit, 100);
	const sliced = matching.slice(0, effectiveLimit);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapResponse(
						{
							results: sliced.map(toApiEntity),
							total_matching: totalMatching,
							returned: sliced.length,
						},
						meta,
					),
					null,
					2,
				),
			},
		],
	};
}
