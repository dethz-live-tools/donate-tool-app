---
description: Prevent agents from editing files in Git submodules to avoid conflicts and tracking issues
globs: ["**/*"]
alwaysApply: true
---

# Rule: Keep Agents Out of Submodules

Agents should not edit any files that are part of a Git submodule.

## Reason
Submodules are external repositories with their own history. Editing them directly can:
- Cause conflicts with the submodule's upstream
- Break the superproject's tracking of the submodule commit
- Lead to unexpected behavior when others update the submodule

## Enforcement
Before editing any file, agents should:
1. Check if the file's path is within a submodule directory
2. If yes, either:
   - Refuse to edit and notify the user, or
   - Require explicit user confirmation to proceed

## Detection
A file is in a submodule if:
- Its path is inside a directory that is a Git submodule (as shown by `git submodule status`)
- Or the directory contains a `.git` file (indicating a submodule checkout)

## Example
Given a submodule at `vendor/lib`:
- `vendor/lib/src/main.js` → **protected** (do not edit)
- `vendor/lib/README.md` → **protected**
- `vendor/lib/.git` → **protected** (internal submodule metadata)
- `src/app.js` → allowed (not in submodule)

## Note for Agent Developers
This rule can be implemented by:
- Running `git rev-parse --show-superproject-working-tree` to detect submodule context
- Checking if the file path starts with any submodule path from `git submodule status --recursive`