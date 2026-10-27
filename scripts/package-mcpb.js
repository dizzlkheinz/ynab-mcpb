#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command, args, options = {}) {
	// Every caller passes process.execPath with fixed arguments; no user input.
	// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
	return result;
}

try {
	const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
	const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
	if (manifest.version !== packageJson.version) {
		throw new Error(
			"Manifest version differs from package.json; run npm run verify:metadata.",
		);
	}
	if (!/^[a-z0-9-]+$/.test(manifest.name)) {
		throw new Error(
			"Manifest name must contain only lowercase letters, digits, and hyphens.",
		);
	}
	if (!fs.existsSync("dist/bundle/index.cjs")) {
		throw new Error("Bundle is missing; run npm run build first.");
	}

	// Resolve the installed CLI and invoke Node directly, including on Windows.
	// Packaging never installs global dependencies or requires PowerShell.
	let cliPackage = path.resolve("node_modules/@anthropic-ai/mcpb/package.json");
	if (!fs.existsSync(cliPackage)) {
		const npmCli = process.env.npm_execpath;
		if (!npmCli)
			throw new Error("Run this command through npm run package:mcpb.");
		const globalRoot = run(process.execPath, [npmCli, "root", "--global"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
		}).stdout.trim();
		cliPackage = path.join(globalRoot, "@anthropic-ai/mcpb/package.json");
	}
	if (!fs.existsSync(cliPackage)) {
		throw new Error(
			"Install the packaging CLI first: npm install --global @anthropic-ai/mcpb",
		);
	}
	const cliMetadata = JSON.parse(fs.readFileSync(cliPackage, "utf8"));
	const cli = path.resolve(path.dirname(cliPackage), cliMetadata.bin);
	const output = path.join(
		"dist",
		`${manifest.name}-${packageJson.version}.mcpb`,
	);
	run(process.execPath, [cli, "validate", "manifest.json"]);
	fs.rmSync(output, { force: true });
	run(process.execPath, [cli, "pack", ".", output]);
	if (!fs.existsSync(output))
		throw new Error(`Packaging did not create ${output}.`);
	console.log(`Created ${output}`);
} catch (error) {
	console.error(`MCPB packaging failed: ${error.message}`);
	process.exit(1);
}
