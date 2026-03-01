import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import type { PSGCEntity, PSGCLevel, SearchIndexEntry } from "./types";
import { KV_PREFIX } from "./types";
import { normalize, deriveAncestorCodes } from "./utils";

// Module-level search index cache (survives across requests within same isolate)
let searchIndexCache: SearchIndexEntry[] | null = null;

const PSGC_LEVELS: [PSGCLevel, ...PSGCLevel[]] = [
	"Reg",
	"Prov",
	"Dist",
	"City",
	"Mun",
	"SubMun",
	"SGU",
	"Bgy",
];

const LISTABLE_LEVELS: [PSGCLevel, ...PSGCLevel[]] = [
	"Reg",
	"Prov",
	"Dist",
	"City",
	"Mun",
	"SubMun",
	"SGU",
];

export class PsgcMCP extends McpAgent {
	server = new McpServer({
		name: "PSGC",
		version: "1.0.0",
	});

	async init() {
		const kv = this.env.PSGC_KV;

		// ── Tool 1: lookup ──────────────────────────────────────────

		this.server.tool(
			"lookup",
			"Look up a Philippine geographic entity by its 10-digit PSGC code. Returns the full entity record including name, level, parent, population, and classification data.",
			{ code: z.string().length(10).describe("10-digit PSGC code") },
			async ({ code }) => {
				const raw = await kv.get(`${KV_PREFIX.entity}:${code}`);
				if (!raw) {
					return {
						content: [
							{
								type: "text",
								text: `No entity found for PSGC code ${code}`,
							},
						],
						isError: true,
					};
				}

				const entity: PSGCEntity = JSON.parse(raw);
				return {
					content: [{ type: "text", text: JSON.stringify(entity, null, 2) }],
				};
			},
		);

		// ── Tool 2: search ──────────────────────────────────────────

		this.server.tool(
			"search",
			"Search Philippine geographic entities by name. Supports partial matching. Use the level filter to narrow results (e.g. only cities, only provinces). For barangay searches, include the parent city/municipality name to get better results.",
			{
				query: z.string().min(1).describe("Search query (place name or partial name)"),
				level: z
					.enum(PSGC_LEVELS)
					.optional()
					.describe("Filter by geographic level"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("Max results (default 10, max 50)"),
			},
			async ({ query, level, limit }) => {
				// Load search index on first call
				if (!searchIndexCache) {
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
					searchIndexCache = JSON.parse(raw);
				}

				const normalizedQuery = normalize(query);
				const maxResults = limit ?? 10;

				// Filter and score matches
				type ScoredEntry = SearchIndexEntry & { score: number };
				const matches: ScoredEntry[] = [];

				for (const entry of searchIndexCache!) {
					if (level && entry.l !== level) continue;
					if (!entry.n.includes(normalizedQuery)) continue;

					let score = 0;
					if (entry.n === normalizedQuery) {
						score = 3; // Exact match
					} else if (entry.n.startsWith(normalizedQuery)) {
						score = 2; // Starts with
					} else {
						score = 1; // Contains
					}

					matches.push({ ...entry, score });
				}

				// Sort by score desc, then name asc
				matches.sort((a, b) => {
					if (a.score !== b.score) return b.score - a.score;
					return a.n.localeCompare(b.n);
				});

				const results = matches.slice(0, maxResults).map((m) => ({
					code: m.c,
					name: m.d,
					level: m.l,
				}));

				return {
					content: [
						{
							type: "text",
							text:
								results.length > 0
									? JSON.stringify(results, null, 2)
									: `No results found for "${query}"${level ? ` at level ${level}` : ""}`,
						},
					],
				};
			},
		);

		// ── Tool 3: get_hierarchy ───────────────────────────────────

		this.server.tool(
			"get_hierarchy",
			"Get the full administrative hierarchy for a PSGC entity. Returns the chain from the entity up through its parent city/municipality, province, and region.",
			{
				code: z.string().length(10).describe("10-digit PSGC code"),
			},
			async ({ code }) => {
				// Get the entity itself
				const entityRaw = await kv.get(`${KV_PREFIX.entity}:${code}`);
				if (!entityRaw) {
					return {
						content: [
							{
								type: "text",
								text: `No entity found for PSGC code ${code}`,
							},
						],
						isError: true,
					};
				}

				const entity: PSGCEntity = JSON.parse(entityRaw);
				const chain: PSGCEntity[] = [entity];

				// Walk up the parent chain using the stored parent field
				let current = entity;
				const visited = new Set<string>([code]);

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

				// If parent chain didn't reach region, try deriving ancestors
				if (chain.length === 1 || chain[chain.length - 1].level !== "Reg") {
					const ancestorCodes = deriveAncestorCodes(code);
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
					content: [{ type: "text", text: JSON.stringify(chain, null, 2) }],
				};
			},
		);

		// ── Tool 4: list_children ───────────────────────────────────

		this.server.tool(
			"list_children",
			"List the direct children of a PSGC entity. For a region, returns provinces/districts. For a province, returns cities/municipalities. For a city/municipality, returns barangays. Optionally filter by level.",
			{
				code: z
					.string()
					.length(10)
					.describe("10-digit PSGC code of the parent entity"),
				level: z
					.enum(PSGC_LEVELS)
					.optional()
					.describe("Filter children by geographic level"),
			},
			async ({ code, level }) => {
				const childrenRaw = await kv.get(`${KV_PREFIX.children}:${code}`);
				if (!childrenRaw) {
					return {
						content: [
							{
								type: "text",
								text: `No children found for PSGC code ${code}. It may be a barangay (leaf level) or the code may be invalid.`,
							},
						],
					};
				}

				const childCodes: string[] = JSON.parse(childrenRaw);

				// Fetch child entities in batches of 100
				const entities: PSGCEntity[] = [];
				for (let i = 0; i < childCodes.length; i += 100) {
					const batch = childCodes.slice(i, i + 100);
					const fetches = batch.map(async (c) => {
						const raw = await kv.get(`${KV_PREFIX.entity}:${c}`);
						return raw ? (JSON.parse(raw) as PSGCEntity) : null;
					});
					const results = await Promise.all(fetches);
					for (const r of results) {
						if (r && (!level || r.level === level)) {
							entities.push(r);
						}
					}
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(entities, null, 2),
						},
					],
				};
			},
		);

		// ── Tool 5: list_by_type ────────────────────────────────────

		this.server.tool(
			"list_by_type",
			"List all PSGC entities of a given geographic level. Barangay (Bgy) is excluded because there are 42,000+ barangays. To find barangays, use 'search' with a name query or 'list_children' on a city/municipality.",
			{
				level: z
					.enum(LISTABLE_LEVELS)
					.describe(
						"Geographic level: Reg (region), Prov (province), Dist (district), City, Mun (municipality), SubMun (sub-municipality), SGU (special geographic unit)",
					),
			},
			async ({ level }) => {
				const codesRaw = await kv.get(`${KV_PREFIX.type}:${level}`);
				if (!codesRaw) {
					return {
						content: [
							{
								type: "text",
								text: `No type index found for level ${level}. Data may not be loaded yet.`,
							},
						],
						isError: true,
					};
				}

				const codes: string[] = JSON.parse(codesRaw);

				// Fetch entities in batches of 100
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
							text: JSON.stringify(entities, null, 2),
						},
					],
				};
			},
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return PsgcMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response(
			"PSGC MCP Server - Philippine Standard Geographic Code data for LLMs.\nConnect via /mcp endpoint.",
			{ status: 200 },
		);
	},
};
