import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker HTTP routing", () => {
	it("GET / returns 200 with server description", async () => {
		const response = await SELF.fetch("http://localhost/");
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("PSGC MCP Server");
	});

	it("GET /mcp does not 404 (routes to MCP handler)", async () => {
		const response = await SELF.fetch("http://localhost/mcp");
		expect(response.status).not.toBe(404);
	});

	it("GET /random returns 200 default response", async () => {
		const response = await SELF.fetch("http://localhost/random");
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("PSGC MCP Server");
	});
});
