#!/usr/bin/env node
/**
 * Generates a PR description from template with smart defaults
 * Usage: node scripts/create-pr-description.js [options]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the PR template
const templatePath = path.join(__dirname, '..', '.github', 'pull_request_template.md');
const template = fs.readFileSync(templatePath, 'utf-8');

// Function to detect the repository's default branch
function getDefaultBranch() {
  try {
    // Try to get the default branch from origin/HEAD
    const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      encoding: 'utf-8',
    })
      .trim()
      .replace('refs/remotes/origin/', '');
    return defaultBranch;
  } catch (err) {
    // Fallback: try common branch names
    try {
      execSync('git rev-parse --verify origin/main', { encoding: 'utf-8', stdio: 'ignore' });
      return 'main';
    } catch {
      try {
        execSync('git rev-parse --verify origin/master', { encoding: 'utf-8', stdio: 'ignore' });
        return 'master';
      } catch {
        console.warn('Could not detect default branch, using "main" as fallback');
        return 'main';
      }
    }
  }
}

// Read package.json for version info
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
);

// Read CHANGELOG.md if it exists
let changelogEntries = '';
try {
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf-8');
  // Extract the latest version entries
  const latestSection = changelog.split('##')[1];
  changelogEntries = latestSection ? `## Latest Changes\n\n${latestSection}` : '';
} catch (err) {
  // No changelog
}

// Detect the default branch
const defaultBranch = getDefaultBranch();

// Get git info
let commitMessages = '';
try {
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();

  // Get commit messages since branching from default branch
  const commits = execSync(`git log ${defaultBranch}..${branch} --pretty=format:"- %s"`, {
    encoding: 'utf-8',
  }).trim();

  if (commits) {
    commitMessages = `## Commits\n\n${commits}\n\n`;
  }
} catch (err) {
  console.warn('Could not get git commit info');
}

// Get file change stats
let changeStats = '';
try {
  const stats = execSync(`git diff --shortstat ${defaultBranch}...HEAD`, {
    encoding: 'utf-8',
  }).trim();

  if (stats) {
    changeStats = `**Changes**: ${stats}\n\n`;
  }
} catch (err) {
  console.warn('Could not get change stats');
}

// Get previous version from default branch
function getPreviousVersion() {
  try {
    // Try to get package.json from default branch
    const previousPackageJson = execSync(`git show origin/${defaultBranch}:package.json`, {
      encoding: 'utf-8',
    });
    const previousPkg = JSON.parse(previousPackageJson);
    return previousPkg.version;
  } catch (err) {
    // Fallback: try to get the latest git tag
    try {
      const latestTag = execSync('git describe --tags --abbrev=0', {
        encoding: 'utf-8',
      }).trim();
      // Remove 'v' prefix if present
      return latestTag.replace(/^v/, '');
    } catch {
      // Fallback: try to get tags sorted by version
      try {
        const tags = execSync('git tag --sort=-v:refname', {
          encoding: 'utf-8',
        }).trim();
        const latestTag = tags.split('\n')[0];
        if (latestTag) {
          return latestTag.replace(/^v/, '');
        }
      } catch {
        console.warn('Could not determine previous version, using current version as fallback');
        return packageJson.version;
      }
    }
  }
  return packageJson.version;
}

// Smart defaults based on branch name and commits
function detectChangeType(branchName, commits) {
  const name = branchName.toLowerCase();
  const commitText = commits.toLowerCase();

  if (name.includes('major') || commitText.includes('breaking') || commitText.includes('major:')) {
    return 'Major';
  } else if (name.includes('minor') || name.includes('feature') || name.includes('feat')) {
    return 'Minor';
  } else if (name.includes('patch') || name.includes('fix') || name.includes('hotfix')) {
    return 'Patch';
  }

  return 'Unknown';
}

const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
const changeType = detectChangeType(branch, commitMessages);

// Build the description
let description = template;

// Add summary if we have commits
if (commitMessages) {
  const summarySection = commitMessages.split('\n').slice(0, 5).join('\n');
  description = description.replace(
    'Describe the change and its motivation.',
    `Describe the change and its motivation.\n\n${summarySection}`,
  );
}

// Pre-check the type of change if we detected it
if (changeType === 'Major') {
  description = description.replace('- [ ] Major', '- [x] Major');
} else if (changeType === 'Minor') {
  description = description.replace('- [ ] Minor', '- [x] Minor');
} else if (changeType === 'Patch') {
  description = description.replace('- [ ] Patch', '- [x] Patch');
}

// Add version info
const currentVersion = packageJson.version;
const previousVersion = getPreviousVersion();
description = description.replace(
  '`X.Y.Z` → `X.Y.Z`',
  `\`${previousVersion}\` → \`${currentVersion}\``,
);

// Add changelog entries if available
if (changelogEntries) {
  description += `\n\n---\n\n${changelogEntries}`;
}

// Add change stats if available
if (changeStats) {
  description += `\n\n${changeStats}`;
}

// Add commit history
if (commitMessages) {
  description += `\n${commitMessages}`;
}

// Output the description
console.log(description);

// Optionally write to file
const outputPath = path.join(__dirname, '..', '.pr-description.md');
fs.writeFileSync(outputPath, description);
console.error(`\n✅ PR description written to: ${outputPath}`);
console.error('\nTo create PR with this description:');
console.error(`  gh pr create --body-file .pr-description.md --title "Your PR title"`);
