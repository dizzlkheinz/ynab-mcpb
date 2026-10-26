#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
	const packageJson = JSON.parse(
		fs.readFileSync(path.join(root, "package.json"), "utf8"),
	);
	const manifest = JSON.parse(
		fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
	);
	const entryPoints = new Set([
		packageJson.main,
		packageJson.types,
		...Object.values(packageJson.bin),
		manifest.server.entry_point,
	]);
	for (const entry of entryPoints) {
		const file = path.resolve(root, entry);
		if (!fs.statSync(file).isFile())
			throw new Error(`Missing entry point: ${entry}`);
		if (!entry.endsWith(".d.ts")) {
			const result = spawnSync(process.execPath, ["--check", file], {
				stdio: "inherit",
			});
			if (result.error) throw result.error;
			if (result.status !== 0) process.exit(result.status ?? 1);
		}
	}
	console.log(`Build verified: ${entryPoints.size} declared entry points.`);
} catch (error) {
	console.error(`Build verification failed: ${error.message}`);
	process.exit(1);
}
