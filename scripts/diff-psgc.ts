/**
 * PSGC Diff Tool
 *
 * Compares two PSGC Publication Excel files and reports changes.
 * Useful for verifying quarterly PSA updates before running the full pipeline.
 *
 * Usage: npm run diff-psgc -- <old.xlsx> <new.xlsx>
 */

import { parseExcelToEntities } from "./parse-psgc";
import type { PSGCEntity } from "../src/types";

interface NameChange {
	code: string;
	oldName: string;
	newName: string;
	level: string;
}

interface FieldChange {
	code: string;
	name: string;
	field: string;
	oldValue: string | number | undefined;
	newValue: string | number | undefined;
}

const COMPARED_FIELDS: (keyof PSGCEntity)[] = [
	"cityClass",
	"incomeClass",
	"urbanRural",
	"population",
	"level",
	"oldName",
];

async function main() {
	const [oldPath, newPath] = process.argv.slice(2);

	if (!oldPath || !newPath) {
		console.error("Usage: npm run diff-psgc -- <old.xlsx> <new.xlsx>");
		process.exit(1);
	}

	console.log(`Old: ${oldPath}`);
	console.log(`New: ${newPath}`);
	console.log();

	const [oldEntities, newEntities] = await Promise.all([
		parseExcelToEntities(oldPath),
		parseExcelToEntities(newPath),
	]);

	console.log(`Old file: ${oldEntities.size} entities`);
	console.log(`New file: ${newEntities.size} entities`);
	console.log();

	// Added codes (in new but not old)
	const added: PSGCEntity[] = [];
	for (const [code, entity] of newEntities) {
		if (!oldEntities.has(code)) {
			added.push(entity);
		}
	}

	// Removed codes (in old but not new)
	const removed: PSGCEntity[] = [];
	for (const [code, entity] of oldEntities) {
		if (!newEntities.has(code)) {
			removed.push(entity);
		}
	}

	// Name changes and field changes (same code, different values)
	const nameChanges: NameChange[] = [];
	const fieldChanges: FieldChange[] = [];

	for (const [code, newEntity] of newEntities) {
		const oldEntity = oldEntities.get(code);
		if (!oldEntity) continue;

		if (oldEntity.name !== newEntity.name) {
			nameChanges.push({
				code,
				oldName: oldEntity.name,
				newName: newEntity.name,
				level: newEntity.level,
			});
		}

		for (const field of COMPARED_FIELDS) {
			const oldVal = oldEntity[field];
			const newVal = newEntity[field];
			if (oldVal !== newVal) {
				fieldChanges.push({
					code,
					name: newEntity.name,
					field,
					oldValue: oldVal as string | number | undefined,
					newValue: newVal as string | number | undefined,
				});
			}
		}
	}

	// Report
	console.log("=== PSGC Diff Report ===");
	console.log();

	console.log(`Added:         ${added.length}`);
	console.log(`Removed:       ${removed.length}`);
	console.log(`Name changes:  ${nameChanges.length}`);
	console.log(`Field changes: ${fieldChanges.length}`);
	console.log();

	if (added.length > 0) {
		console.log("--- Added ---");
		for (const e of added) {
			console.log(`  ${e.code}  ${e.name} (${e.level})`);
		}
		console.log();
	}

	if (removed.length > 0) {
		console.log("--- Removed ---");
		for (const e of removed) {
			console.log(`  ${e.code}  ${e.name} (${e.level})`);
		}
		console.log();
	}

	if (nameChanges.length > 0) {
		console.log("--- Name Changes ---");
		for (const c of nameChanges) {
			console.log(`  ${c.code}  "${c.oldName}" -> "${c.newName}" (${c.level})`);
		}
		console.log();
	}

	if (fieldChanges.length > 0) {
		console.log("--- Field Changes ---");
		for (const c of fieldChanges) {
			console.log(`  ${c.code}  ${c.name}: ${c.field} "${c.oldValue}" -> "${c.newValue}"`);
		}
		console.log();
	}

	// Exit code: 0 if no surprises beyond name changes
	const hasUnexpected = added.length > 0 || removed.length > 0;
	if (hasUnexpected) {
		console.log("WARNING: Structural changes detected (additions or removals).");
		process.exit(1);
	}

	console.log("No structural changes. Safe to proceed with pipeline update.");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
