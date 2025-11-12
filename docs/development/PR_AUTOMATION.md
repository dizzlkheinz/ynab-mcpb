# PR Description Automation

This document explains how to automatically generate and validate PR descriptions that conform to the repository's PR template.

## Quick Start

### Creating a PR with Auto-Generated Description

```bash
# Generate PR description and create the PR
npm run pr:create

# Or manually generate the description first
npm run pr:description
gh pr create --body-file .pr-description.md --title "Your PR Title"
```

### Updating an Existing PR Description

```bash
# Generate description
npm run pr:description

# Update existing PR
gh pr edit <PR_NUMBER> --body-file .pr-description.md
```

## Available Tools

### 1. GitHub Action - Automatic Validation ✅

**File**: `.github/workflows/pr-description-check.yml`

**What it does**:
- Automatically runs when a PR is opened or edited
- Checks if PR description includes required template sections
- Comments on the PR if sections are missing
- Fails the check to prevent merging incomplete PRs

**Required sections**:
- Type of change
- Public API surface checklist
- Versioning and release

### 2. NPM Script - Smart Description Generator 📝

**Usage**: `npm run pr:description`

**What it does**:
- Reads the PR template
- Analyzes your git commits and branch name
- Auto-detects the type of change (Major/Minor/Patch)
- Includes commit messages and change statistics
- Extracts relevant CHANGELOG entries
- Outputs to `.pr-description.md`

**Smart defaults**:
- Branch with `major` or `breaking` → Major change
- Branch with `feat` or `feature` → Minor change
- Branch with `fix` or `patch` → Patch change
- Automatically fills in version from `package.json`
- Pre-checks appropriate checkboxes

### 3. Combined Script - One-Step PR Creation 🚀

**Usage**: `npm run pr:create`

**What it does**:
- Generates the description
- Creates a new PR with the generated description
- You just need to provide the title

## Manual Template Compliance

If you prefer to write manually, ensure your PR includes:

### ✅ Type of Change
```markdown
## Type of change

- [ ] Patch (backwards‑compatible fixes)
- [ ] Minor (backwards‑compatible features)
- [x] Major (breaking changes)
```

### ✅ Public API Surface Checklist
```markdown
## Public API surface checklist

- Tools
  - [x] No tool removals/renames, or deprecations documented
  - [x] No changes to required args; only additive optional args
  - [x] Output shapes preserved (only additive fields)
- Resources
  - [x] URIs unchanged or deprecations documented
  - [x] Response shapes preserved (only additive fields)
- Prompts
  - [x] Names/arguments unchanged or deprecations documented
- Manifest/config
  - [x] `user_config.YNAB_ACCESS_TOKEN` remains the auth key
  - [x] `server.entry_point` and `mcp_config.env` remain compatible
- Runtime behavior
  - [x] Auth and error semantics unchanged
  - [x] `get_env_status` still functional
```

### ✅ Versioning and Release
```markdown
## Versioning and release

- Proposed version bump: `0.7.x` → `0.8.0`
- [x] Changelog entry prepared (Added/Changed/Fixed/Removed)
- [x] Tests and lint pass locally
- [x] Built DXT with `npm run package:dxt` and sanity‑checked
```

## Examples

### Example 1: Creating a Feature PR

```bash
# 1. Create your feature branch
git checkout -b feat/enhanced-caching

# 2. Make your changes and commit
git add .
git commit -m "feat: Add enhanced caching with LRU eviction"

# 3. Generate and create PR
npm run pr:create

# The script will:
# - Detect it's a Minor change (feat/ branch)
# - Pre-check "Minor" in the template
# - Include your commit messages
# - Create the PR with proper formatting
```

### Example 2: Updating an Existing PR

```bash
# Your PR was flagged for missing sections

# 1. Generate a compliant description
npm run pr:description

# 2. Review the generated file
cat .pr-description.md

# 3. Update your PR
gh pr edit 123 --body-file .pr-description.md
```

### Example 3: Major Version Release

```bash
# 1. Create release branch
git checkout -b major/v1.0.0

# 2. Make breaking changes
git add .
git commit -m "breaking: Standardize response format"

# 3. Generate description
npm run pr:description

# The script will:
# - Detect Major change
# - Include all commits since master
# - Extract CHANGELOG entries for v1.0.0
# - Pre-fill version bump info

# 4. Create PR
gh pr create --body-file .pr-description.md --title "v1.0.0: Major Release"
```

## Customization

### Modify the Generator Script

Edit `scripts/create-pr-description.js` to customize:
- Change type detection logic
- Add more smart defaults
- Include additional sections
- Format commit messages differently

### Adjust the GitHub Action

Edit `.github/workflows/pr-description-check.yml` to:
- Change required sections
- Modify validation rules
- Add custom checks
- Send notifications

## Troubleshooting

### "Missing required sections" error

**Solution**: Run `npm run pr:description` and copy the generated content.

### Script doesn't detect change type correctly

**Solution**: Name your branch with:
- `major/` or `breaking/` for major changes
- `feat/` or `feature/` for minor changes
- `fix/` or `patch/` for patch changes

### Generated description doesn't include my commits

**Solution**: Ensure you've committed your changes before running the script:
```bash
git add .
git commit -m "Your changes"
npm run pr:description
```

### GitHub CLI errors

**Solution**: Ensure `gh` is installed and authenticated:
```bash
gh auth status
gh auth login  # if not authenticated
```

## Benefits

### ✅ Consistency
- All PRs follow the same format
- No more missing template sections
- Standardized documentation

### ⏱️ Time Savings
- Auto-generate descriptions in seconds
- No manual copying of template
- Smart defaults reduce typing

### 🔒 Quality Assurance
- GitHub Action enforces compliance
- Catches incomplete PRs early
- Reduces review cycles

### 📊 Better Reviews
- All necessary information present
- Clear change categorization
- Proper version tracking

## Related Documentation

- [PR Template](.github/pull_request_template.md)
- [Versioning Guide](VERSIONING.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [CHANGELOG](../CHANGELOG.md)

---

💡 **Pro Tip**: Add `npm run pr:description` to your pre-push git hook to always have a PR description ready!
