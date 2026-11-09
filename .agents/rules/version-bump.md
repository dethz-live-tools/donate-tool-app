---
description: Bump version after making changes to track AI agent work
globs: ["**/*"]
alwaysApply: true
---

# Rule: Bump Version After AI Agent Work

When you make changes to code as an AI agent, you should bump the project version to track your work.

## Why
- Provides clear tracking of when AI agents have made modifications
- Helps users understand what changes were made by AI vs. humans
- Follows semantic versioning practices for project maintenance

## When to Bump
After completing any set of changes (file edits, additions, deletions), check if version tracking exists and bump appropriately.

## How to Bump Version

### 1. Check for VERSION file
Look for a `VERSION` file in the project root:
- If it exists, read the current version (format: X.Y.Z)
- Increment the patch version (Z) by 1
- Write the new version back to the file
- Example: `1.2.3` → `1.2.4`

### 2. Check for package.json
If no VERSION file but a `package.json` exists:
- Read the current version from the `"version"` field
- Increment the patch version
- Write the updated version back to package.json

### 3. Other Common Files
Similarly check for:
- `Cargo.toml` (look for `version = "X.Y.Z"` under `[package]`)
- `pyproject.toml` (look for `version = "X.Y.Z"` under `[project]`)
- `setup.py` or `setup.cfg`

### 4. Create VERSION file if none exist
If no version tracking files are found:
- Create a `VERSION` file in the project root
- Set initial version to `1.0.0`
- Then bump to `1.0.1` after your first changes

### 5. Check for Release Note Rule
Only generate a release note if the project includes the `release-note.md` rule:
- Check if `release-note.md` exists in the project (e.g., in `rules/release-note.md`, `.cursor/rules/release-note.md`, or the project's configured rules)
- **If present**: create `RELEASED_NOTE-{version}.md` following the instructions in `release-note.md`
- **If NOT present**: do NOT create any release note file; only bump the version

## Implementation Notes
- Only bump version when you've made meaningful changes (not just whitespace or comments)
- If multiple agents are working, coordinate to avoid version conflicts
- Consider committing version bumps separately with message: "bump version: X.Y.Z → X.Y.(Z+1)"
- For breaking changes or major features, consider bumping minor or major version instead of patch
- Only generate `RELEASED_NOTE-{version}.md` when the project has the `release-note.md` rule included
<!-- ponytail: limited to common version files (VERSION, package.json, etc.), extend as needed for project-specific formats -->