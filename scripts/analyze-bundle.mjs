import fs from "node:fs";

let meta;
try {
	meta = JSON.parse(fs.readFileSync("meta.json", "utf-8"));
} catch (error) {
	console.error("❌ Error reading meta.json:", error.message);
	process.exit(1);
}
if (!meta.inputs || typeof meta.inputs !== "object") {
	console.error("❌ Error: meta.inputs is missing or invalid in meta.json");
	process.exit(1);
}

const inputs = Object.entries(meta.inputs)
	.map(([path, data]) => ({
		path,
		bytes: data.bytes,
	}))
	.sort((a, b) => b.bytes - a.bytes)
	.slice(0, 20);

const totalBytes = Object.values(meta.inputs).reduce(
	(sum, item) => sum + item.bytes,
	0,
);
console.log(
	`\n📦 Total input size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
);
const outputKey = "dist/bundle/index.cjs";
if (!meta.outputs || !meta.outputs[outputKey]) {
	console.error(
		`❌ Error: meta.outputs['${outputKey}'] is missing in meta.json`,
	);
	process.exit(1);
}
console.log(
	`📦 Output size: ${(meta.outputs[outputKey].bytes / 1024 / 1024).toFixed(2)} MB`,
);
console.log("\n📊 Top 20 largest inputs in bundle:\n");
for (const item of inputs) {
	const kb = (item.bytes / 1024).toFixed(1).padStart(8);
	console.log(`${kb} KB  ${item.path}`);
}
