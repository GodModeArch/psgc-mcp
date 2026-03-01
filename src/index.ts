import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import type { PSGCLevel } from "./types";
import {
	handleLookup,
	handleSearch,
	handleGetHierarchy,
	handleListChildren,
	handleListByType,
} from "./tool-handlers";
import type { SearchCache } from "./tool-handlers";

// Module-level search index cache (survives across requests within same isolate)
const searchIndexCache: SearchCache = { current: null };

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
			async ({ code }) => handleLookup({ code }, kv),
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
			async ({ query, level, limit }) =>
				handleSearch({ query, level, limit }, kv, searchIndexCache),
		);

		// ── Tool 3: get_hierarchy ───────────────────────────────────

		this.server.tool(
			"get_hierarchy",
			"Get the full administrative hierarchy for a PSGC entity. Returns the chain from the entity up through its parent city/municipality, province, and region.",
			{
				code: z.string().length(10).describe("10-digit PSGC code"),
			},
			async ({ code }) => handleGetHierarchy({ code }, kv),
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
			async ({ code, level }) => handleListChildren({ code, level }, kv),
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
			async ({ level }) => handleListByType({ level }, kv),
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
