/**
 * PSGC Excel Parser
 *
 * Reads the PSA PSGC Publication Excel file and outputs chunked JSON files
 * suitable for Cloudflare KV bulk upload via wrangler.
 *
 * Usage: npm run parse-psgc
 * Expects: scripts/data/PSGC-*.xlsx (or psgc*.xlsx)
 */

import ExcelJS from "exceljs";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalize, deriveParentCode } from "../src/utils";
import type { PSGCEntity, PSGCLevel, SearchIndexEntry } from "../src/types";
import { KV_PREFIX } from "../src/types";

const DATA_DIR = path.join(import.meta.dirname, "data");
const OUTPUT_DIR = path.join(DATA_DIR, "output");
const CHUNK_SIZE = 10_000;

// ── Find the Excel file ──────────────────────────────────────────────

function findExcelFile(): string {
	const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".xlsx"));
	const psgcFile = files.find(
		(f) => f.toLowerCase().startsWith("psgc") || f.includes("PSGC"),
	);
	if (!psgcFile) {
		console.error("No PSGC Excel file found in scripts/data/");
		console.error("Place the PSA PSGC Publication .xlsx file there first.");
		process.exit(1);
	}
	return path.join(DATA_DIR, psgcFile);
}

// ── Map geographic level string from Excel to PSGCLevel ──────────────

const LEVEL_MAP: Record<string, PSGCLevel> = {
	Reg: "Reg",
	Prov: "Prov",
	Dist: "Dist",
	City: "City",
	Mun: "Mun",
	SubMun: "SubMun",
	"Sub-Mun": "SubMun",
	SGU: "SGU",
	Bgy: "Bgy",
};

function parseLevel(raw: string): PSGCLevel | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	return LEVEL_MAP[trimmed] ?? null;
}

// ── Detect column positions from header row ──────────────────────────

interface ColumnMap {
	code: number;
	name: number;
	correspondenceCode: number;
	level: number;
	oldName: number;
	cityClass: number;
	incomeClass: number;
	urbanRural: number;
	population: number;
}

function detectColumns(headerRow: ExcelJS.Row): ColumnMap {
	const map: Partial<ColumnMap> = {};

	headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
		const val = String(cell.value ?? "")
			.toLowerCase()
			.trim();

		if (val.includes("10-digit") || val.includes("psgc")) {
			map.code = colNumber;
		} else if (val === "name" || val === "name of location") {
			map.name = colNumber;
		} else if (val.includes("correspondence")) {
			map.correspondenceCode = colNumber;
		} else if (
			val.includes("geographic level") ||
			val.includes("inter-level") ||
			val.includes("interlevel")
		) {
			map.level = colNumber;
		} else if (val.includes("old name")) {
			map.oldName = colNumber;
		} else if (val.includes("city class")) {
			map.cityClass = colNumber;
		} else if (val.includes("income class")) {
			map.incomeClass = colNumber;
		} else if (val.includes("urban") || val.includes("rural")) {
			map.urbanRural = colNumber;
		} else if (val.includes("population")) {
			map.population = colNumber;
		}
	});

	// Validate required columns
	if (!map.code || !map.name || !map.level) {
		console.error("Could not detect required columns from header row.");
		console.error("Found:", map);
		process.exit(1);
	}

	return map as ColumnMap;
}

// ── Cell value helpers ───────────────────────────────────────────────

function cellStr(row: ExcelJS.Row, col: number | undefined): string | undefined {
	if (!col) return undefined;
	const val = row.getCell(col).value;
	if (val == null) return undefined;
	const str = String(val).trim();
	return str || undefined;
}

function cellNum(row: ExcelJS.Row, col: number | undefined): number | undefined {
	if (!col) return undefined;
	const val = row.getCell(col).value;
	if (val == null) return undefined;
	const num = Number(val);
	return Number.isFinite(num) ? num : undefined;
}

// ── Pad code to 10 digits ────────────────────────────────────────────

function padCode(raw: string | number): string {
	const str = String(raw).replace(/\D/g, "");
	return str.padStart(10, "0");
}

// ── Main parse function ──────────────────────────────────────────────

async function main() {
	const excelPath = findExcelFile();
	console.log(`Reading: ${excelPath}`);

	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.readFile(excelPath);

	// Find the PSGC data worksheet (usually first or named "PSGC")
	let worksheet: ExcelJS.Worksheet | undefined;
	for (const ws of workbook.worksheets) {
		const name = ws.name.toLowerCase();
		if (name.includes("psgc") || name === "sheet1") {
			worksheet = ws;
			break;
		}
	}
	if (!worksheet) {
		worksheet = workbook.worksheets[0];
	}
	if (!worksheet) {
		console.error("No worksheet found in workbook.");
		process.exit(1);
	}
	console.log(`Worksheet: "${worksheet.name}" (${worksheet.rowCount} rows)`);

	// Detect header row (scan first 10 rows for one containing "10-digit" or "PSGC")
	let columns: ColumnMap | null = null;
	let headerRowNum = 0;
	for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
		const row = worksheet.getRow(r);
		let hasCodeHeader = false;
		row.eachCell({ includeEmpty: false }, (cell) => {
			const val = String(cell.value ?? "").toLowerCase();
			if (val.includes("10-digit") || (val.includes("psgc") && val.includes("code"))) {
				hasCodeHeader = true;
			}
		});
		if (hasCodeHeader) {
			columns = detectColumns(row);
			headerRowNum = r;
			break;
		}
	}

	if (!columns) {
		console.error("Could not find header row in first 10 rows.");
		process.exit(1);
	}
	console.log(`Header row: ${headerRowNum}, columns:`, columns);

	// ── Parse all data rows ────────────────────────────────────────

	const entities = new Map<string, PSGCEntity>();
	let skipped = 0;

	for (let r = headerRowNum + 1; r <= worksheet.rowCount; r++) {
		const row = worksheet.getRow(r);
		const rawCode = cellStr(row, columns.code);
		const rawName = cellStr(row, columns.name);
		const rawLevel = cellStr(row, columns.level);

		if (!rawCode || !rawName || !rawLevel) {
			skipped++;
			continue;
		}

		const level = parseLevel(rawLevel);
		if (!level) {
			skipped++;
			continue;
		}

		const code = padCode(rawCode);
		if (code.length !== 10) {
			skipped++;
			continue;
		}

		const entity: PSGCEntity = {
			code,
			name: rawName,
			level,
		};

		const oldName = cellStr(row, columns.oldName);
		if (oldName) entity.oldName = oldName;

		const cityClass = cellStr(row, columns.cityClass);
		if (cityClass) entity.cityClass = cityClass;

		const incomeClass = cellStr(row, columns.incomeClass);
		if (incomeClass) entity.incomeClass = incomeClass;

		const urbanRural = cellStr(row, columns.urbanRural);
		if (urbanRural) entity.urbanRural = urbanRural;

		const pop = cellNum(row, columns.population);
		if (pop != null) entity.population = pop;

		// Derive region and province codes
		entity.regionCode = code.slice(0, 2) + "00000000";
		if (code.slice(2, 4) !== "00") {
			entity.provinceCode = code.slice(0, 4) + "000000";
		}

		entities.set(code, entity);
	}

	console.log(`Parsed: ${entities.size} entities, skipped: ${skipped} rows`);

	// ── Derive parent codes ────────────────────────────────────────

	for (const entity of entities.values()) {
		const parentCode = deriveParentCode(entity.code, entity.level);
		if (!parentCode) continue;

		if (entities.has(parentCode)) {
			entity.parent = parentCode;
		} else {
			// HUC/ICC fix: derived province doesn't exist, try region or district
			if (entity.level === "City" || entity.level === "Mun") {
				const regionCode = entity.code.slice(0, 2) + "00000000";

				// Check if there's a district in this region that contains this city
				// NCR districts have codes like 13XX000000
				const distCode = entity.code.slice(0, 4) + "000000";
				if (entities.has(distCode) && entities.get(distCode)!.level === "Dist") {
					entity.parent = distCode;
				} else {
					// Try all districts in the region
					let foundDist = false;
					for (const [code, e] of entities) {
						if (
							e.level === "Dist" &&
							code.startsWith(entity.code.slice(0, 2)) &&
							code.slice(2, 4) === entity.code.slice(2, 4)
						) {
							entity.parent = code;
							foundDist = true;
							break;
						}
					}
					if (!foundDist) {
						entity.parent = regionCode;
					}
				}
			} else {
				// Fallback to region
				entity.parent = entity.code.slice(0, 2) + "00000000";
			}
		}
	}

	// Verify parent assignment stats
	let noParent = 0;
	let hasParent = 0;
	for (const e of entities.values()) {
		if (e.level === "Reg") continue;
		if (e.parent) hasParent++;
		else noParent++;
	}
	console.log(`Parents assigned: ${hasParent}, missing: ${noParent}`);

	// ── Build KV datasets ──────────────────────────────────────────

	type KVEntry = { key: string; value: string };
	const kvEntries: KVEntry[] = [];

	// 1. Entity records
	for (const entity of entities.values()) {
		kvEntries.push({
			key: `${KV_PREFIX.entity}:${entity.code}`,
			value: JSON.stringify(entity),
		});
	}
	console.log(`Entity KV entries: ${kvEntries.length}`);

	// 2. Children index
	const childrenMap = new Map<string, string[]>();
	for (const entity of entities.values()) {
		if (entity.parent) {
			const children = childrenMap.get(entity.parent) ?? [];
			children.push(entity.code);
			childrenMap.set(entity.parent, children);
		}
	}
	for (const [parentCode, children] of childrenMap) {
		kvEntries.push({
			key: `${KV_PREFIX.children}:${parentCode}`,
			value: JSON.stringify(children.sort()),
		});
	}
	console.log(`Children index entries: ${childrenMap.size}`);

	// 3. Type index (skip Bgy - too large)
	const typeMap = new Map<PSGCLevel, string[]>();
	for (const entity of entities.values()) {
		if (entity.level === "Bgy") continue;
		const codes = typeMap.get(entity.level) ?? [];
		codes.push(entity.code);
		typeMap.set(entity.level, codes);
	}
	for (const [level, codes] of typeMap) {
		kvEntries.push({
			key: `${KV_PREFIX.type}:${level}`,
			value: JSON.stringify(codes.sort()),
		});
	}
	console.log(
		`Type index entries: ${typeMap.size} (levels: ${[...typeMap.keys()].join(", ")})`,
	);

	// 4. Search index (all entities)
	const searchIndex: SearchIndexEntry[] = [];
	for (const entity of entities.values()) {
		searchIndex.push({
			n: normalize(entity.name),
			d: entity.name,
			c: entity.code,
			l: entity.level,
		});
	}
	kvEntries.push({
		key: KV_PREFIX.searchIndex,
		value: JSON.stringify(searchIndex),
	});
	console.log(
		`Search index: ${searchIndex.length} entries, ~${(JSON.stringify(searchIndex).length / 1024 / 1024).toFixed(1)}MB`,
	);

	// ── Write chunked output files ─────────────────────────────────

	if (fs.existsSync(OUTPUT_DIR)) {
		fs.rmSync(OUTPUT_DIR, { recursive: true });
	}
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	let fileIndex = 0;
	for (let i = 0; i < kvEntries.length; i += CHUNK_SIZE) {
		const chunk = kvEntries.slice(i, i + CHUNK_SIZE);
		const filePath = path.join(OUTPUT_DIR, `kv-${String(fileIndex).padStart(3, "0")}.json`);
		fs.writeFileSync(filePath, JSON.stringify(chunk, null, 2));
		console.log(`Wrote ${filePath} (${chunk.length} entries)`);
		fileIndex++;
	}

	console.log(`\nDone. ${fileIndex} file(s) written to ${OUTPUT_DIR}`);
	console.log("Run 'npm run upload-kv' to upload to Cloudflare KV.");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
