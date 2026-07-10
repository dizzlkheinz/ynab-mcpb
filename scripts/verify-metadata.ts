import fs from "node:fs";
import path from "node:path";

interface PackageJson {
	name: string;
	mcpName: string;
	version: string;
}

interface ManifestJson {
	version: string;
	tools: Array<{ name: string }>;
	prompts: Array<{ name: string }>;
}

interface ServerJson {
	name: string;
	description: string;
	version: string;
	packages: Array<{ identifier: string; version: string }>;
}

function readJson<T>(file: string): T {
	return JSON.parse(
		fs.readFileSync(path.join(process.cwd(), file), "utf8"),
	) as T;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertSameSet(label: string, left: string[], right: string[]): void {
	const leftSorted = [...left].sort();
	const rightSorted = [...right].sort();
	assert(
		JSON.stringify(leftSorted) === JSON.stringify(rightSorted),
		`${label} differ:\nsource=${leftSorted.join(",")}\nruntime=${rightSorted.join(",")}`,
	);
}

process.env["DOTENV_CONFIG_PATH"] = path.join(
	process.cwd(),
	".metadata-validation-no-dotenv",
);
process.env["YNAB_ACCESS_TOKEN"] = "metadata-validation-token";
process.env["YNAB_MCP_WRITE_MODE"] = "enabled";
process.env["YNAB_MCP_TOOL_PROFILE"] = "full";

const packageJson = readJson<PackageJson>("package.json");
const packageLock = readJson<{
	version: string;
	packages: { "": { version: string } };
}>("package-lock.json");
const manifest = readJson<ManifestJson>("manifest.json");
const serverJson = readJson<ServerJson>("server.json");
const { YNABMCPServer } = await import("../src/server/YNABMCPServer.js");
const server = new YNABMCPServer(false);
const runtimeTools = (await server.handleListTools()).tools;
const runtimePrompts = (await server.handleListPrompts()).prompts;
const runtimeResources = (await server.handleListResources()).resources;
const runtimeResourceTemplates = (await server.handleListResourceTemplates())
	.resourceTemplates;
const fullDefinitions = server.getToolRegistry().getToolDefinitions();
const externalMutations = fullDefinitions.filter(
	(tool) =>
		tool.metadata?.annotations?.readOnlyHint === false &&
		tool.metadata.annotations.openWorldHint === true,
);
const unprotectedMutations = externalMutations.filter(
	(tool) => tool.metadata?.writeSafety?.mutation !== true,
);
assert(
	unprotectedMutations.length === 0,
	`External mutations missing centralized write safety: ${unprotectedMutations
		.map((tool) => tool.name)
		.join(",")}`,
);

for (const [source, version] of [
	["package-lock.json", packageLock.version],
	["package-lock root package", packageLock.packages[""].version],
	["manifest.json", manifest.version],
	["server.json", serverJson.version],
	["server.json npm package", serverJson.packages[0]?.version],
	["runtime server info", server.getServerVersion()],
] as const) {
	assert(
		version === packageJson.version,
		`${source} version ${version ?? "missing"} does not match package.json ${packageJson.version}`,
	);
}

assert(
	serverJson.name === packageJson.mcpName,
	"server.json name must match package.json mcpName",
);
assert(
	serverJson.packages[0]?.identifier === packageJson.name,
	"server.json package identifier must match package.json name",
);
assert(
	serverJson.description.length <= 100,
	`server.json description exceeds the MCP Registry 100-character limit (${serverJson.description.length})`,
);
assertSameSet(
	"Manifest and runtime tools",
	manifest.tools.map((tool) => tool.name),
	runtimeTools.map((tool) => tool.name),
);
assert(runtimeResources.length === 2, "Expected two concrete MCP resources");
assert(
	runtimeResourceTemplates.length === 6,
	"Expected six MCP resource templates",
);

process.env["YNAB_MCP_WRITE_MODE"] = "preview";
const previewServer = new YNABMCPServer(false);
const previewTools = (await previewServer.handleListTools()).tools;
for (const mutation of externalMutations) {
	const previewTool = previewTools.find((tool) => tool.name === mutation.name);
	assert(previewTool, `Preview mode did not register ${mutation.name}`);
	assert(
		"confirmation_token" in (previewTool.inputSchema.properties ?? {}),
		`Preview mode did not advertise confirmation_token for ${mutation.name}`,
	);
}

process.env["YNAB_MCP_WRITE_MODE"] = "read-only";
const readOnlyServer = new YNABMCPServer(false);
const readOnlyNames = new Set(
	(await readOnlyServer.handleListTools()).tools.map((tool) => tool.name),
);
for (const mutation of externalMutations) {
	assert(
		!readOnlyNames.has(mutation.name),
		`Read-only mode unexpectedly registered ${mutation.name}`,
	);
}
assertSameSet(
	"Manifest and runtime prompts",
	manifest.prompts.map((prompt) => prompt.name),
	runtimePrompts.map((prompt) => prompt.name),
);

const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
const apiDocs = fs.readFileSync(
	path.join(process.cwd(), "docs/reference/API.md"),
	"utf8",
);
const documentedCounts = [
	...readme.matchAll(/\*\*(\d+) YNAB tools\*\*/g),
	...apiDocs.matchAll(/provides (\d+) tools/g),
].map((match) => Number(match[1]));
assert(
	documentedCounts.length >= 2,
	"Expected tool-count declarations in README and API docs",
);
for (const count of documentedCounts) {
	assert(
		count === runtimeTools.length,
		`Documented tool count ${count} does not match runtime ${runtimeTools.length}`,
	);
}

console.log(
	`Metadata verified: version ${packageJson.version}, ${runtimeTools.length} tools, ${runtimePrompts.length} prompts.`,
);
