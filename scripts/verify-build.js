#!/usr/bin/env node

/**
 * Build Verification Script
 * Verifies that the build output is correct and complete
 */

import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST_DIR = path.join(__dirname, '..', 'dist');
const REQUIRED_FILES = [
  'index.js',
  'index.d.ts',
  'server/YNABMCPServer.js',
  'server/YNABMCPServer.d.ts',
  'tools/budgetTools.js',
  'tools/budgetTools.d.ts',
  'tools/accountTools.js',
  'tools/accountTools.d.ts',
  'tools/transactionTools.js',
  'tools/transactionTools.d.ts',
  'tools/categoryTools.js',
  'tools/categoryTools.d.ts',
  'tools/payeeTools.js',
  'tools/payeeTools.d.ts',
  'tools/monthTools.js',
  'tools/monthTools.d.ts',
  'tools/utilityTools.js',
  'tools/utilityTools.d.ts',
  'types/index.js',
  'types/index.d.ts',
];

function verifyBuild() {
  console.log('🔍 Verifying build output...\n');

  // Check if dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ Build directory does not exist:', DIST_DIR);
    process.exit(1);
  }

  const missingFiles = [];
  const foundFiles = [];

  // Check for required files
  for (const file of REQUIRED_FILES) {
    const filePath = path.join(DIST_DIR, file);
    if (fs.existsSync(filePath)) {
      foundFiles.push(file);
      console.log(`✅ ${file}`);
    } else {
      missingFiles.push(file);
      console.error(`❌ Missing: ${file}`);
    }
  }

  // Check main entry point
  const mainEntry = path.join(DIST_DIR, 'index.js');
  if (fs.existsSync(mainEntry)) {
    const content = fs.readFileSync(mainEntry, 'utf8');
    if (content.includes('YNABMCPServer')) {
      console.log('✅ Main entry point contains expected exports');
    } else {
      console.error('❌ Main entry point missing expected exports');
      missingFiles.push('index.js (invalid content)');
    }
  }

  // Check TypeScript declarations
  const hasDeclarations = foundFiles.some((file) => file.endsWith('.d.ts'));
  if (hasDeclarations) {
    console.log('✅ TypeScript declarations generated');
  } else {
    console.error('❌ No TypeScript declarations found');
  }

  // Summary
  console.log(`\n📊 Build Verification Summary:`);
  console.log(`   Found files: ${foundFiles.length}`);
  console.log(`   Missing files: ${missingFiles.length}`);

  if (missingFiles.length > 0) {
    console.error('\n❌ Build verification failed!');
    console.error('Missing files:');
    missingFiles.forEach((file) => console.error(`   - ${file}`));
    process.exit(1);
  } else {
    console.log('\n✅ Build verification passed!');
    console.log('All required files are present and valid.');
  }
}

// Run verification if this script is executed directly
if (process.argv[1] === __filename) {
  verifyBuild();
}

export { verifyBuild };
