/**
 * PSGC KV Uploader
 *
 * Iterates JSON files in scripts/data/output/ and uploads each to
 * Cloudflare KV via `wrangler kv bulk put`.
 *
 * Usage: npm run upload-kv
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OUTPUT_DIR = path.join(import.meta.dirname, "data", "output");

function main() {
	if (!fs.existsSync(OUTPUT_DIR)) {
		console.error(`Output directory not found: ${OUTPUT_DIR}`);
		console.error("Run 'npm run parse-psgc' first.");
		process.exit(1);
	}

	const files = fs
		.readdirSync(OUTPUT_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort();

	if (files.length === 0) {
		console.error("No JSON files found in output directory.");
		process.exit(1);
	}

	console.log(`Found ${files.length} file(s) to upload.\n`);

	for (let i = 0; i < files.length; i++) {
		const filePath = path.join(OUTPUT_DIR, files[i]);
		const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));

		console.log(
			`[${i + 1}/${files.length}] Uploading ${files[i]} (${entries.length} entries)...`,
		);

		try {
			execSync(
				`npx wrangler kv bulk put "${filePath}" --binding=PSGC_KV`,
				{ stdio: "inherit" },
			);
			console.log(`  Done.\n`);
		} catch (err) {
			console.error(`  Failed to upload ${files[i]}. Stopping.`);
			process.exit(1);
		}
	}

	console.log("All files uploaded successfully.");
}

main();
