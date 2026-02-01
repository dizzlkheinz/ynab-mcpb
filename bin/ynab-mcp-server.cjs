#!/usr/bin/env node
const path = require("node:path");
const entry = path.resolve(__dirname, "../dist/bundle/index.cjs");
require(entry);
