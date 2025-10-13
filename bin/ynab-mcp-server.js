#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, '../dist/index.js');

await import(entry);
