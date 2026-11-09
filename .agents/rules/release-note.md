---
trigger: always_on
description: Create a RELEASED_NOTE/{version}.md file every time a new version is bumped (when this rule is present in the project)
globs: ["**/*"]
---

# Rule: Generate RELEASED_NOTE/{version}.md on Version Bump

When working on a project that includes this rule (`release-note.md`), every time you bump a project version as an AI agent, you must create a corresponding release note file named `RELEASED_NOTE/{version}.md` in the project root.

## Reason
- Provides a dedicated, immutable record of changes for each released version
- Makes it easy for users and automated pipelines to review what changed per release
- Pairs directly with version bumping to maintain clean project history and release tracking

## When to Create
- Only when this rule (`release-note.md`) is present in the target project
- Whenever a new version is bumped (patch, minor, or major) in files such as `VERSION`, `package.json`, `pyproject.toml`, `Cargo.toml`, etc.
- As part of completing your work, before finalizing your changes

## Naming Convention
- File name pattern: `RELEASED_NOTE/{version}.md`
- `{version}` must match the newly bumped version exactly (e.g., `1.0.1`, `2.1.0`)
- Place the file in the project root directory
- Examples:
  - `RELEASED_NOTE/1.0.1.md`
  - `RELEASED_NOTE/2.0.0.md`

## Release Note Content Structure

Each `RELEASED_NOTE/{version}.md` file must include:
1. **Title**: Project name and the new version
2. **Release Date**: Current date in `YYYY-MM-DD` format
3. **Overview**: Brief 1–3 sentence summary of what this release accomplishes
4. **Categorized Changes**:
   - **Added**: New features, files, or capabilities
   - **Changed**: Modifications to existing behavior, refactors, dependency updates
   - **Fixed**: Bug fixes or error corrections
   - **Removed**: Deprecated or deleted functionality
5. **Key Files Changed**: List of primary files modified or added

## Release Note Template

Use the following template for `RELEASED_NOTE/{version}.md`:

```markdown
# Release Notes - v{version}

**Release Date:** YYYY-MM-DD  
**Version:** {version}  
**Bump Type:** [patch | minor | major]

## Summary
Brief high-level summary of what was introduced, fixed, or modified in this version.

## What's Changed

### Added
- Description of new feature or file added

### Changed
- Description of existing functionality or configuration modified

### Fixed
- Description of bug or issue resolved

### Removed
- Description of deprecated or removed code/features (if any)

## Key Files Changed
- `path/to/file1.ext` - Brief note on what changed
- `path/to/file2.ext` - Brief note on what changed
```

## Agent Guidelines
- **Never overwrite prior notes**: Each version must have its own standalone file (e.g., do not overwrite `RELEASED_NOTE/1.0.0.md` when creating `RELEASED_NOTE/1.0.1.md`).
- **Base notes on actual changes**: Only document changes that actually occurred in this specific version bump.
- **Omit empty sections**: If there are no removals or no bug fixes, omit or mark the section as `None`.
- **Commit with the version bump**: Include `RELEASED_NOTE/{version}.md` in the same commit as the version bump, or commit it with a clear commit message (e.g., `docs: add RELEASED_NOTE/{version}.md`).