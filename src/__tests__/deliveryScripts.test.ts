import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packagingScript = fileURLToPath(
	new URL("../../scripts/package-mcpb.js", import.meta.url),
);
let fixture = "";
const artifact = "dist/fixture-1.0.0.mcpb";

function write(relativePath: string, contents: string) {
	const destination = path.join(fixture, relativePath);
	mkdirSync(path.dirname(destination), { recursive: true });
	writeFileSync(destination, contents);
}

function packageFixture() {
	return spawnSync(process.execPath, [packagingScript], {
		cwd: fixture,
		encoding: "utf8",
	});
}

beforeEach(() => {
	fixture = mkdtempSync(path.join(tmpdir(), "ynab-delivery-test-"));
	write("package.json", JSON.stringify({ version: "1.0.0" }));
	write("manifest.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
	write("dist/bundle/index.cjs", "// fixture bundle");
	write(
		"node_modules/@anthropic-ai/mcpb/package.json",
		JSON.stringify({ bin: "cli.cjs" }),
	);
});

afterEach(() => {
	// Only remove the directory created by this test's mkdtemp call.
	if (
		fixture &&
		path.dirname(fixture) === path.resolve(tmpdir()) &&
		path.basename(fixture).startsWith("ynab-delivery-test-")
	) {
		rmSync(fixture, { recursive: true, force: true });
	}
});

describe("MCPB packaging command", () => {
	it("fails when no build exists", () => {
		rmSync(path.join(fixture, "dist/bundle/index.cjs"));
		const result = packageFixture();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("run npm run build first");
	});

	it("propagates manifest validation failures without packing", () => {
		write(
			"node_modules/@anthropic-ai/mcpb/cli.cjs",
			`if (process.argv[2] === "validate") process.exit(7);
require("node:fs").writeFileSync(process.argv[4], "unexpected archive");`,
		);
		expect(packageFixture().status).toBe(7);
		expect(existsSync(path.join(fixture, artifact))).toBe(false);
	});

	it("propagates packing failures", () => {
		write(
			"node_modules/@anthropic-ai/mcpb/cli.cjs",
			`if (process.argv[2] === "pack") process.exit(9);`,
		);
		expect(packageFixture().status).toBe(9);
	});

	it("does not report success using a stale archive", () => {
		write(artifact, "old archive");
		write("node_modules/@anthropic-ai/mcpb/cli.cjs", "process.exit(0);");
		const result = packageFixture();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Packaging did not create");
	});

	it("creates the versioned archive when the CLI succeeds", () => {
		write(
			"node_modules/@anthropic-ai/mcpb/cli.cjs",
			`if (process.argv[2] === "pack") {
require("node:fs").writeFileSync(process.argv[4], "archive");
}`,
		);
		const result = packageFixture();
		expect(result.status).toBe(0);
		expect(existsSync(path.join(fixture, artifact))).toBe(true);
	});
});
