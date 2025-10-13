#!/usr/bin/env node
const path = require('path');
const entry = path.resolve(__dirname, '../dist/bundle/index.cjs');
require(entry);
