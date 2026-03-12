# Pagination, Pre-Hydration, and Child Counts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all five issues found during ren.ph stress testing: oversized responses, subrequest limits, missing pagination, no response guards, and missing count data.

**Architecture:** Eliminate per-entity KV reads for list operations by storing pre-hydrated entity arrays in `children:` and `type:` KV keys (computed at parse time). Add offset/limit pagination to all list tools. Embed descendant counts on every entity so `lookup` alone provides count data without additional queries.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare KV, Vitest

---

## Design Decisions

### Pre-hydrated KV values (1 read per list operation)

Current: `children:{code}` and `type:{level}` store arrays of PSGC code strings. Handlers then do N individual `entity:{code}` lookups to hydrate each record. For 1,486 municipalities, that's 1,487 KV reads and blows past Cloudflare's subrequest limit.

New: Store full `PSGCEntity` objects directly in `children:` and `type:` values. The handler does exactly 1 KV read, paginates the array in memory, and returns the page. The parser does the pre-hydration at build time (runs once per quarter).

KV value sizes stay well within the 25MB limit. Worst case is `type:Mun` at ~370KB (1,486 entities * ~250 bytes).

### Descendant counts on every entity

Add `childCounts: Record<PSGCLevel, number> | null` to `PSGCEntity`. Computed at parse time via bottom-up tree traversal. A province like Ilocos Norte gets `{ City: 2, Mun: 21, Bgy: 557 }`. A barangay gets `null` (leaf node).

This means `lookup("0102800000")` returns counts for free. For the ren.ph coverage page, `batch_lookup` of all 82 provinces gives every count in a single request (82 KV reads). No list_children calls needed.

### Direct children only (verified)

The parser already builds direct-children-only indexes. Each entity is added to its resolved parent's children list. A province's `children:` key contains only its cities/municipalities, not barangays. If production KV has incorrect data, re-uploading after these parser changes will fix it.

### Pagination envelope

```json
{
  "_meta": { ... },
  "data": [ ...entities... ],
  "pagination": {
    "total_count": 1486,
    "offset": 0,
    "limit": 50,
    "has_more": true
  }
}
```

Additive change. The `data` field shape is unchanged. `pagination` is a new top-level field alongside `_meta` and `data`. The `level` filter on `list_children` applies before pagination, so `total_count` reflects the filtered count.

### Pagination defaults

- `offset`: default 0, min 0
- `limit`: default 50, min 1, max 200 (for list_children and list_by_type)
- `query_by_population` keeps its existing limit (default 10, max 100) but gains `offset`

---

## Task 1: Add childCounts to PSGCEntity type

**Files:**
- Modify: `src/types.ts:11-23`

**Step 1: Add childCounts field to PSGCEntity**

```typescript
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
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Errors in parser and fixtures where PSGCEntity objects are constructed without childCounts. This is expected and will be fixed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Add childCounts field to PSGCEntity type"
```

---

## Task 2: Add child_counts to ApiEntity and pagination types

**Files:**
- Modify: `src/response.ts:1-83`

**Step 1: Add child_counts to ApiEntity interface**

Add after `parent_code`:

```typescript
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
	child_counts: Partial<Record<PSGCLevel, number>> | null;
}
```

**Step 2: Add PaginationMeta interface**

```typescript
export interface PaginationMeta {
	total_count: number;
	offset: number;
	limit: number;
	has_more: boolean;
}
```

**Step 3: Add wrapPaginatedResponse function**

```typescript
export function wrapPaginatedResponse<T>(
	data: T,
	meta: ApiMeta,
	pagination: PaginationMeta,
): { _meta: ApiMeta; data: T; pagination: PaginationMeta } {
	return { _meta: meta, data, pagination };
}
```

**Step 4: Update toApiEntity to include child_counts**

```typescript
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
		child_counts: entity.childCounts ?? null,
	};
}
```

**Step 5: Commit**

```bash
git add src/response.ts
git commit -m "Add child_counts to ApiEntity and pagination response types"
```

---

## Task 3: Update test fixtures for pre-hydrated KV and childCounts

**Files:**
- Modify: `test/fixtures/entities.ts:1-282`
- Modify: `test/fixtures/meta.ts:1-23`

**Step 1: Add childCounts to all fixture entities**

Every fixture entity needs `childCounts`. Examples:

```typescript
// NCR region: has districts, cities, barangays under it
export const NCR: PSGCEntity = {
	...existing fields,
	childCounts: { Dist: 1, City: 2, SubMun: 1 },
};

// BULACAN province: has cities, muns, barangays under it
export const BULACAN: PSGCEntity = {
	...existing fields,
	childCounts: { City: 1, Mun: 1, Bgy: 2 },
};

// MARILAO municipality: has barangays
export const MARILAO: PSGCEntity = {
	...existing fields,
	childCounts: { Bgy: 2 },
};

// ABANGAN_NORTE barangay: leaf node
export const ABANGAN_NORTE: PSGCEntity = {
	...existing fields,
	childCounts: null,
};
```

Calculate childCounts from the fixture hierarchy:
- NCR → NCR_FIRST_DISTRICT (Dist), Manila (City), QC (City), Tondo (SubMun)
- CENTRAL_LUZON → BULACAN (Prov), Malolos (City), Marilao (Mun), Abangan Norte (Bgy), Nono (Bgy)
- MIMAROPA → KALAYAAN (SGU)
- BULACAN → Malolos (City), Marilao (Mun), Abangan Norte (Bgy), Nono (Bgy)
- NCR_FIRST_DISTRICT → Manila (City), Tondo (SubMun)
- MANILA → Tondo (SubMun)
- MARILAO → Abangan Norte (Bgy), Nono (Bgy)
- All leaf entities (QC, MALOLOS, TONDO, KALAYAAN, ABANGAN_NORTE, NONO_BGY): null

Note: QC's parent is NCR (not a district), Malolos's parent is Bulacan. Malolos is a city but has no children in fixtures, so childCounts is null (or {} but null is cleaner for "no children in data").

**Step 2: Update generateMarilaoBarangays to include childCounts**

```typescript
export function generateMarilaoBarangays(count: number): PSGCEntity[] {
	const bgys: PSGCEntity[] = [];
	for (let i = 0; i < count; i++) {
		const suffix = String(200 + i).padStart(3, "0");
		bgys.push({
			...existing fields,
			childCounts: null,
		});
	}
	return bgys;
}
```

**Step 3: Update buildSeededKV to store pre-hydrated arrays**

Change children index from code arrays to entity arrays:

```typescript
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
	// Sort by code for deterministic order
	children.sort((a, b) => a.code.localeCompare(b.code));
	kvData[`${KV_PREFIX.children}:${parentCode}`] = children;
}
```

Change type index from code arrays to entity arrays:

```typescript
// Build type index (pre-hydrated entity arrays, skip Bgy)
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
```

**Step 4: Add parseEnvelope helper that handles pagination**

In `test/fixtures/meta.ts`, update `parseData` or add a new helper:

```typescript
export interface ParsedPaginatedResponse<T> {
	data: T;
	pagination: { total_count: number; offset: number; limit: number; has_more: boolean };
}

export function parsePaginated<T>(
	result: { content: { type: string; text: string }[] },
): ParsedPaginatedResponse<T> {
	const envelope = JSON.parse(result.content[0].text);
	return { data: envelope.data as T, pagination: envelope.pagination };
}
```

**Step 5: Commit**

```bash
git add test/fixtures/entities.ts test/fixtures/meta.ts
git commit -m "Update test fixtures for pre-hydrated KV and childCounts"
```

---

## Task 4: Rewrite handleListChildren with pre-hydrated data and pagination

**Files:**
- Modify: `src/tool-handlers.ts:213-259`
- Modify: `src/index.ts:103-119`
- Modify: `test/unit/list-children.test.ts`

**Step 1: Update tool schema in index.ts**

Add offset and limit params:

```typescript
this.server.tool(
	"list_children",
	"List the direct children of a PSGC entity. For a region, returns provinces/districts. For a province, returns cities/municipalities. For a city/municipality, returns barangays. Optionally filter by level. Paginated (default limit: 50).",
	{
		code: z
			.string()
			.length(10)
			.describe("10-digit PSGC code of the parent entity"),
		level: z
			.enum(PSGC_LEVELS)
			.optional()
			.describe("Filter children by geographic level"),
		offset: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("Number of records to skip (default 0)"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(200)
			.optional()
			.describe("Max records to return (default 50, max 200)"),
	},
	async ({ code, level, offset, limit }) =>
		handleListChildren({ code, level, offset, limit }, kv, meta),
);
```

**Step 2: Rewrite handleListChildren**

```typescript
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
```

**Step 3: Update list-children tests**

Rewrite tests for new behavior. Key tests:

```typescript
describe("handleListChildren", () => {
	it("returns informational message when no children key exists", async () => {
		const result = await handleListChildren({ code: "9999999999" }, kv, TEST_META);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("No children found");
	});

	it("returns direct child entities with pagination metadata", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data.map((e) => e.psgc_code)).toContain(MALOLOS.code);
		expect(data.map((e) => e.psgc_code)).toContain(MARILAO.code);
		expect(pagination.total_count).toBe(2);
		expect(pagination.has_more).toBe(false);
	});

	it("level filter applies before pagination", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, level: "Mun" },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(1);
		expect(data[0].psgc_code).toBe(MARILAO.code);
		expect(pagination.total_count).toBe(1);
	});

	it("offset skips records", async () => {
		const result = await handleListChildren(
			{ code: BULACAN.code, offset: 1, limit: 10 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(1);
		expect(pagination.offset).toBe(1);
		expect(pagination.has_more).toBe(false);
	});

	it("limit caps results and sets has_more", async () => {
		kv = buildSeededKV(100);
		const result = await handleListChildren(
			{ code: MARILAO.code, limit: 10 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(10);
		expect(pagination.total_count).toBe(102); // Abangan Norte + Nono + 100 generated
		expect(pagination.has_more).toBe(true);
	});

	it("default limit is 50", async () => {
		kv = buildSeededKV(100);
		const result = await handleListChildren(
			{ code: MARILAO.code },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(50);
		expect(pagination.limit).toBe(50);
		expect(pagination.has_more).toBe(true);
	});

	it("empty children array returns empty data with pagination", async () => {
		kv.seed({ "children:0000000000": JSON.stringify([]) });
		const result = await handleListChildren({ code: "0000000000" }, kv, TEST_META);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toEqual([]);
		expect(pagination.total_count).toBe(0);
		expect(pagination.has_more).toBe(false);
	});

	it("child entities include child_counts", async () => {
		const result = await handleListChildren({ code: BULACAN.code }, kv, TEST_META);
		const { data } = parsePaginated<ApiEntity[]>(result);
		const marilao = data.find((e) => e.psgc_code === MARILAO.code);
		expect(marilao?.child_counts).toEqual({ Bgy: 2 });
	});
});
```

**Step 4: Run tests**

Run: `npm test`
Expected: list-children tests pass. Other tests may have failures from fixture changes (addressed in subsequent tasks).

**Step 5: Commit**

```bash
git add src/tool-handlers.ts src/index.ts test/unit/list-children.test.ts
git commit -m "Rewrite list_children with pre-hydrated data and pagination"
```

---

## Task 5: Rewrite handleListByType with pre-hydrated data and pagination

**Files:**
- Modify: `src/tool-handlers.ts:261-308`
- Modify: `src/index.ts:121-134`
- Modify: `test/unit/list-by-type.test.ts`

**Step 1: Update tool schema in index.ts**

Add offset and limit params to list_by_type:

```typescript
this.server.tool(
	"list_by_type",
	"List all PSGC entities of a given geographic level. Barangay (Bgy) is excluded because there are 42,000+ barangays. To find barangays, use 'search' with a name query or 'list_children' on a city/municipality. Paginated (default limit: 50).",
	{
		level: z
			.enum(LISTABLE_LEVELS)
			.describe(
				"Geographic level: Reg (region), Prov (province), Dist (district), City, Mun (municipality), SubMun (sub-municipality), SGU (special geographic unit)",
			),
		offset: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("Number of records to skip (default 0)"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(200)
			.optional()
			.describe("Max records to return (default 50, max 200)"),
	},
	async ({ level, offset, limit }) =>
		handleListByType({ level, offset, limit }, kv, meta),
);
```

**Step 2: Rewrite handleListByType**

```typescript
export async function handleListByType(
	args: { level: PSGCLevel; offset?: number; limit?: number },
	kv: KVGet,
	meta: ApiMeta,
): Promise<ToolResult> {
	const raw = await kv.get(`${KV_PREFIX.type}:${args.level}`);
	if (!raw) {
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

	const entities: PSGCEntity[] = JSON.parse(raw);
	const totalCount = entities.length;
	const offset = args.offset ?? 0;
	const limit = Math.min(args.limit ?? 50, 200);
	const page = entities.slice(offset, offset + limit);

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
```

**Step 3: Rewrite list-by-type tests**

```typescript
describe("handleListByType", () => {
	it("returns entities with pagination metadata for valid level", async () => {
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		expect(result.isError).toBeUndefined();
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data.map((e) => e.psgc_code)).toContain(NCR.code);
		expect(pagination.total_count).toBe(3); // NCR, Central Luzon, MIMAROPA
	});

	it("returns isError for missing type index (Bgy not indexed)", async () => {
		const result = await handleListByType({ level: "Bgy" as "Reg" }, kv, TEST_META);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No type index found");
	});

	it("pagination offset and limit work correctly", async () => {
		const result = await handleListByType(
			{ level: "Reg", offset: 1, limit: 1 },
			kv,
			TEST_META,
		);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toHaveLength(1);
		expect(pagination.total_count).toBe(3);
		expect(pagination.offset).toBe(1);
		expect(pagination.has_more).toBe(true);
	});

	it("entities include child_counts", async () => {
		const result = await handleListByType({ level: "Prov" }, kv, TEST_META);
		const { data } = parsePaginated<ApiEntity[]>(result);
		const bulacan = data.find((e) => e.psgc_code === BULACAN.code);
		expect(bulacan?.child_counts).toEqual({ City: 1, Mun: 1, Bgy: 2 });
	});

	it("empty type array returns empty data with pagination", async () => {
		kv.seed({ "type:Reg": JSON.stringify([]) });
		const result = await handleListByType({ level: "Reg" }, kv, TEST_META);
		const { data, pagination } = parsePaginated<ApiEntity[]>(result);
		expect(data).toEqual([]);
		expect(pagination.total_count).toBe(0);
	});
});
```

**Step 4: Run tests**

Run: `npm test`
Expected: list-by-type tests pass.

**Step 5: Commit**

```bash
git add src/tool-handlers.ts src/index.ts test/unit/list-by-type.test.ts
git commit -m "Rewrite list_by_type with pre-hydrated data and pagination"
```

---

## Task 6: Update handleQueryByPopulation for pre-hydrated data

**Files:**
- Modify: `src/tool-handlers.ts:361-493`
- Modify: `src/index.ts:151-197`
- Modify: `test/unit/query-by-population.test.ts`

**Step 1: Add offset to tool schema**

Add offset param to query_by_population schema in index.ts:

```typescript
offset: z
	.number()
	.int()
	.min(0)
	.optional()
	.describe("Number of records to skip (default 0)"),
```

**Step 2: Rewrite handleQueryByPopulation**

The key change: read pre-hydrated entity arrays instead of code arrays + per-entity lookups.

```typescript
export async function handleQueryByPopulation(
	args: {
		level: PSGCLevel;
		parent_code?: string;
		min_population?: number;
		max_population?: number;
		sort?: "asc" | "desc";
		offset?: number;
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
		offset: rawOffset,
		limit = 10,
	} = args;

	// Validation (unchanged)
	if (min_population !== undefined && max_population !== undefined && min_population > max_population) {
		return {
			content: [{ type: "text", text: `min_population (${min_population}) cannot exceed max_population (${max_population}).` }],
			isError: true,
		};
	}

	if (level === "Bgy" && !parent_code) {
		return {
			content: [{ type: "text", text: "parent_code is required when querying barangays (Bgy) by population. There are 42,000+ barangays; narrow the scope with a parent city/municipality code." }],
			isError: true,
		};
	}

	// Get pre-hydrated entities (1 KV read)
	let raw: string | null;
	if (level === "Bgy") {
		raw = await kv.get(`${KV_PREFIX.children}:${parent_code}`);
	} else {
		raw = await kv.get(`${KV_PREFIX.type}:${level}`);
	}

	if (!raw) {
		return {
			content: [{
				type: "text",
				text: level === "Bgy"
					? `No children found for parent code ${parent_code}.`
					: `No type index found for level ${level}. Data may not be loaded yet.`,
			}],
			isError: true,
		};
	}

	const entities: PSGCEntity[] = JSON.parse(raw);

	// Derive parent prefix for filtering
	const parentPrefix = parent_code ? parent_code.replace(/0+$/, "") : undefined;

	// Filter
	const matching = entities.filter((entity) => {
		if (entity.level !== level) return false;
		if (entity.population === null) return false;
		if (parentPrefix && level !== "Bgy" && !entity.code.startsWith(parentPrefix)) return false;
		if (min_population !== undefined && entity.population < min_population) return false;
		if (max_population !== undefined && entity.population > max_population) return false;
		return true;
	});

	// Sort
	matching.sort((a, b) =>
		sort === "asc"
			? (a.population ?? 0) - (b.population ?? 0)
			: (b.population ?? 0) - (a.population ?? 0),
	);

	// Paginate
	const totalMatching = matching.length;
	const offset = rawOffset ?? 0;
	const effectiveLimit = Math.min(limit, 100);
	const page = matching.slice(offset, offset + effectiveLimit);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					wrapPaginatedResponse(page.map(toApiEntity), meta, {
						total_count: totalMatching,
						offset,
						limit: effectiveLimit,
						has_more: offset + effectiveLimit < totalMatching,
					}),
					null,
					2,
				),
			},
		],
	};
}
```

**Step 3: Update query-by-population tests**

Update tests to expect pagination envelope instead of `{ results, total_matching, returned }`. The test patterns mirror the existing tests but parse with `parsePaginated` instead of `parseData`.

Key changes:
- All response parsing uses `parsePaginated<ApiEntity[]>(result)`
- Assertions on `pagination.total_count` instead of `total_matching`
- Add test for offset pagination

**Step 4: Run tests**

Run: `npm test`
Expected: All query-by-population tests pass.

**Step 5: Commit**

```bash
git add src/tool-handlers.ts src/index.ts test/unit/query-by-population.test.ts
git commit -m "Update query_by_population for pre-hydrated data and pagination"
```

---

## Task 7: Fix remaining tests (lookup, response-contract, batch-lookup, etc.)

**Files:**
- Modify: `test/unit/lookup.test.ts` (if it checks for missing childCounts)
- Modify: `test/unit/response.test.ts`
- Modify: `test/unit/response-contract.test.ts`
- Modify: `test/unit/batch-lookup.test.ts`
- Modify: `test/unit/get-hierarchy.test.ts`

**Step 1: Read all remaining test files to identify what needs updating**

Tests that construct PSGCEntity objects directly or assert on ApiEntity shape will need `childCounts`/`child_counts` added.

**Step 2: Update each test file**

- Add `childCounts: null` to any inline PSGCEntity construction
- Add `child_counts: null` to any ApiEntity shape assertions
- Response contract tests: update expected ApiEntity keys to include `child_counts`

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add test/
git commit -m "Update remaining tests for childCounts field"
```

---

## Task 8: Update parser to compute childCounts and pre-hydrate indexes

**Files:**
- Modify: `scripts/parse-psgc.ts:289-397`

**Step 1: Add computeDescendantCounts function**

After `resolveParents`, add:

```typescript
function computeDescendantCounts(
	entities: Map<string, PSGCEntity>,
	childrenMap: Map<string, string[]>,
): void {
	// Memoization cache
	const cache = new Map<string, Partial<Record<PSGCLevel, number>>>();

	function getCounts(code: string): Partial<Record<PSGCLevel, number>> {
		if (cache.has(code)) return cache.get(code)!;

		const directChildren = childrenMap.get(code) ?? [];
		const counts: Partial<Record<PSGCLevel, number>> = {};

		for (const childCode of directChildren) {
			const child = entities.get(childCode);
			if (!child) continue;

			// Count this child's level
			counts[child.level] = (counts[child.level] ?? 0) + 1;

			// Add this child's descendant counts
			const childDescendants = getCounts(childCode);
			for (const [level, count] of Object.entries(childDescendants)) {
				const lvl = level as PSGCLevel;
				counts[lvl] = (counts[lvl] ?? 0) + count;
			}
		}

		cache.set(code, counts);
		return counts;
	}

	// Compute for every entity
	for (const entity of entities.values()) {
		const counts = getCounts(entity.code);
		entity.childCounts = Object.keys(counts).length > 0 ? counts : null;
	}
}
```

**Step 2: Build childrenMap before KV entry generation**

Move the childrenMap construction before the KV entry loop so it can be shared between `computeDescendantCounts` and KV entry generation:

```typescript
// Build children map (direct children only - matches how parser assigns parents)
const childrenMap = new Map<string, string[]>();
for (const entity of entities.values()) {
	if (entity.parent) {
		const children = childrenMap.get(entity.parent) ?? [];
		children.push(entity.code);
		childrenMap.set(entity.parent, children);
	}
}
console.log(`Children index entries: ${childrenMap.size}`);

// Compute descendant counts (must happen after childrenMap is built)
computeDescendantCounts(entities, childrenMap);

let hasChildCounts = 0;
for (const e of entities.values()) {
	if (e.childCounts) hasChildCounts++;
}
console.log(`Entities with child counts: ${hasChildCounts}`);
```

**Step 3: Change children and type KV entries to store pre-hydrated entity arrays**

```typescript
// 2. Children index (pre-hydrated entity arrays)
for (const [parentCode, childCodes] of childrenMap) {
	const childEntities = childCodes
		.map((c) => entities.get(c))
		.filter((e): e is PSGCEntity => e !== undefined)
		.sort((a, b) => a.code.localeCompare(b.code));
	kvEntries.push({
		key: `${KV_PREFIX.children}:${parentCode}`,
		value: JSON.stringify(childEntities),
	});
}

// 3. Type index (pre-hydrated entity arrays, skip Bgy)
const typeMap = new Map<PSGCLevel, PSGCEntity[]>();
for (const entity of entities.values()) {
	if (entity.level === "Bgy") continue;
	const list = typeMap.get(entity.level) ?? [];
	list.push(entity);
	typeMap.set(entity.level, list);
}
for (const [level, levelEntities] of typeMap) {
	levelEntities.sort((a, b) => a.code.localeCompare(b.code));
	kvEntries.push({
		key: `${KV_PREFIX.type}:${level}`,
		value: JSON.stringify(levelEntities),
	});
}
```

**Step 4: Run parser test**

Run: `npm test -- test/pipeline/parse-psgc.test.ts`
Expected: May need updates if parser tests check KV value shapes.

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add scripts/parse-psgc.ts test/pipeline/parse-psgc.test.ts
git commit -m "Compute descendant counts and pre-hydrate children/type indexes in parser"
```

---

## Task 9: Update parser tests for new output format

**Files:**
- Modify: `test/pipeline/parse-psgc.test.ts`

**Step 1: Read the parser test file**

Check what assertions exist on KV output format.

**Step 2: Update assertions**

- Children index values should be entity arrays, not code arrays
- Type index values should be entity arrays, not code arrays
- Entity records should include childCounts field

**Step 3: Run parser tests**

Run: `npm test -- test/pipeline/parse-psgc.test.ts`
Expected: All pass.

**Step 4: Commit**

```bash
git add test/pipeline/parse-psgc.test.ts
git commit -m "Update parser tests for pre-hydrated output format"
```

---

## Task 10: Run full test suite and type check

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean (no errors).

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Fix any remaining issues**

Address any type errors or test failures.

**Step 4: Commit fixes if any**

---

## Task 11: CHANGELOG and version bump

**Files:**
- Modify: `CHANGELOG.md`
- Run: `npm version minor --no-git-tag-version`

**Step 1: Add changelog entries**

Under `## [Unreleased]`, add:

```markdown
### Changed

- **list_children: return direct children only with pagination.** Pre-hydrated children indexes eliminate per-entity KV reads. Responses include `pagination` metadata with `total_count`, `offset`, `limit`, and `has_more`. Default limit: 50, max: 200.

- **list_by_type: add pagination.** Same pre-hydration and pagination approach. A `list_by_type("Mun")` call now does 1 KV read instead of ~1,500. Default limit: 50, max: 200.

- **query_by_population: use pre-hydrated data and add offset pagination.** Eliminates per-entity KV reads. Adds `offset` parameter. Response uses standard pagination envelope.

### Added

- **child_counts on all entities.** Every entity now includes descendant counts by geographic level (e.g., a province shows `{ City: 2, Mun: 21, Bgy: 557 }`). Computed at parse time. Available on `lookup`, `batch_lookup`, `list_children`, `list_by_type`, `get_hierarchy`, and `query_by_population` responses.
```

**Step 2: Move to versioned section**

Move entries from `[Unreleased]` to `[1.4.0] - 2026-03-08`.

**Step 3: Bump version**

Run: `npm version minor --no-git-tag-version`

**Step 4: Commit**

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "Release v1.4.0"
```

---

## Post-Implementation

After merge to main:

1. Run `npm run parse-psgc` to regenerate KV data with new format
2. Run `npm test` to verify against new parsed data
3. Run `npm run upload-kv` to push pre-hydrated data to production
4. Tag: `git tag v1.4.0`
5. Push: `git push origin main --tags`
