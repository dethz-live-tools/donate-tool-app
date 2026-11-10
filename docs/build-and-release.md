# Build & Release Guide

This guide covers local development, multi-platform builds, and automated GitHub Releases for `donate-socket`.

---

## 1. Prerequisites

- **Bun**: v1.1.0 or higher (`curl -fsSL https://bun.sh/install | bash`)
- **Node.js**: v20 or higher (LTS recommended)
- **Rust**: Stable toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- **Tauri CLI**: Installed automatically via project devDependencies (`bun run tauri`)
- **OS-Specific Build Tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux (Ubuntu/Debian)**:
    ```bash
    sudo apt-get update && sudo apt-get install -y \
      libwebkit2gtk-4.1-dev \
      libappindicator3-dev \
      librsvg2-dev \
      patchelf \
      xdg-utils \
      libasound2-dev \
      libssl-dev
    ```
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2 runtime

---

## 2. Local Development

### Run Desktop App with Hot Reloading
```bash
bun run dev:ui
```
This runs `tauri dev`, which spawns:
- The backend server on `http://127.0.0.1:3001`
- The Vite frontend dev server on `http://localhost:1420`
- The native Tauri desktop window

### Run Browser/Dev Mode (Without Native Desktop Shell)
```bash
bun run dev
```
Runs both `server/index.ts` and Vite dev server simultaneously via `dev.ts`.

### Standalone Backend Server
```bash
bun run server
# or with file watcher:
bun run dev:server
```

---

## 3. Local Production Build

To compile release bundles locally on your current operating system:

```bash
bun run tauri build
```

Bundles will be generated in `src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` installer and `.app` bundle in `bundle/dmg/` and `bundle/macos/`
- **Linux**: `.deb` and `.AppImage` in `bundle/deb/` and `bundle/appimage/`
- **Windows**: `.msi` and setup executable in `bundle/msi/` and `bundle/nsis/`

---

## 4. Automated Multi-OS GitHub Workflow

The repository includes an automated GitHub Actions workflow at [`.github/workflows/release.yml`](file:///.github/workflows/release.yml).

### Build Matrix
The workflow builds simultaneously on clean virtual environments for:
1. **macOS Apple Silicon**: `macos-latest` targeting `aarch64-apple-darwin`
2. **macOS Intel**: `macos-latest` targeting `x86_64-apple-darwin`
3. **Linux**: `ubuntu-22.04` (x86_64) generating `.deb` and `.AppImage`
4. **Windows**: `windows-latest` (x86_64) generating `.msi` and `.exe` installers

### Trigger Conditions
- **Git Tags**: Any tag pushed matching `v*` (e.g. `git tag v1.0.0 && git push origin v1.0.0`).
- **Version Bump on `main`**: Any push to `main` where `version` in `package.json` / `tauri.conf.json` has been updated and no matching Git tag exists yet. (If the tag already exists, the build is skipped to conserve runner minutes).
- **Manual Trigger**: Can be manually run via the GitHub Actions **Run workflow** button with an optional `force_release` toggle.

### Release Notes
The workflow automatically checks for a matching release note file at `RELEASED_NOTE/{version}.md` (or `RELEASED_NOTE/v{version}.md`) and uses its contents as the GitHub Release body.
