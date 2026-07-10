import path from "node:path";
import { Buffer } from "node:buffer";
import type { ToolProfile } from "../src/server/toolProfiles.js";

process.env["DOTENV_CONFIG_PATH"] = path.join(
	process.cwd(),
	".tool-measurement-no-dotenv",
);
process.env["YNAB_ACCESS_TOKEN"] = "tool-profile-measurement-token";
process.env["YNAB_MCP_WRITE_MODE"] = "enabled";

const { YNABMCPServer } = await import("../src/server/YNABMCPServer.js");
const profiles: ToolProfile[] = ["core", "read-only", "full"];

for (const profile of profiles) {
	process.env["YNAB_MCP_TOOL_PROFILE"] = profile;
	const server = new YNABMCPServer(false);
	const payload = await server.handleListTools();
	console.log(
		JSON.stringify({
			profile,
			tool_count: payload.tools.length,
			tools_list_bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
		}),
	);
}
