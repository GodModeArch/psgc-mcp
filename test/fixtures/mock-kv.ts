/**
 * Minimal KV mock backed by a Map. Implements only the .get() method
 * used by the tool handlers (no put/delete/list needed for read-only tests).
 */
export class MockKV {
	private store = new Map<string, string>();

	seed(entries: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(entries)) {
			this.store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		}
	}

	/** Set a raw string value (bypassing JSON.stringify). Useful for injecting malformed data. */
	setRaw(key: string, value: string): void {
		this.store.set(key, value);
	}

	get(key: string): Promise<string | null> {
		return Promise.resolve(this.store.get(key) ?? null);
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	has(key: string): boolean {
		return this.store.has(key);
	}

	clear(): void {
		this.store.clear();
	}
}
