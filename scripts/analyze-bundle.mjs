import fs from 'fs';

const meta = JSON.parse(fs.readFileSync('meta.json', 'utf-8'));

const inputs = Object.entries(meta.inputs)
  .map(([path, data]) => ({
    path,
    bytes: data.bytes,
  }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 20);

console.log('\n📊 Top 20 largest inputs in bundle:\n');
inputs.forEach((item) => {
  const kb = (item.bytes / 1024).toFixed(1).padStart(8);
  console.log(`${kb} KB  ${item.path}`);
});

const totalBytes = Object.values(meta.inputs).reduce((sum, item) => sum + item.bytes, 0);
console.log(`\n📦 Total input size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`📦 Output size: ${(meta.outputs['dist/bundle/index.cjs'].bytes / 1024 / 1024).toFixed(2)} MB`);
