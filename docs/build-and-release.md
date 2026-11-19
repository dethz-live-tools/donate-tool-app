# Build & Release Guide

This guide covers local development, multi-platform builds, and automated GitHub Releases for `donate-socket`.

---

## 1. Prerequisites

- **Bun**: v1.1.0 or higher (`curl -fsSL https://bun.sh/install | bash`)
- **Node.js**: v20+ LTS (GitHub workflows run Node 24 for actions)
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

### Tests & Audits
```bash
# Run TypeScript server, Studio, security, and i18n unit tests
bun test

# Run Rust desktop shell unit tests (config path resolution & migration)
cd src-tauri && cargo test

# Run dependency vulnerability audit
bun audit
```

---

## 3. Local Production Build

To compile release bundles locally on your current operating system:

```bash
# Full build (frontend -> standalone backend binary -> Tauri desktop bundle)
bun run build:full

# Or run the Tauri CLI directly (tauri.conf.json triggers beforeBuildCommand)
bun run tauri build
```

Bundles will be generated in `src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` installer and `.app` bundle in `bundle/dmg/` and `bundle/macos/`
- **Linux**: `.deb` and `.AppImage` in `bundle/deb/` and `bundle/appimage/`
- **Windows**: `.msi` and setup executable in `bundle/msi/` and `bundle/nsis/`

### Packaged configuration

Desktop releases bundle a standalone backend (`--windows-hide-console` / `CREATE_NO_WINDOW` on Windows) and a credential-free `config.example.yaml`. On first launch, the backend copies that template to a writable `config.yaml` in the application's data directory. On Windows, if a legacy `zip.kizuna.donate\config.yaml` exists in the older Tauri app data directory and `%APPDATA%\dethz-lab\dethz-socket\config.yaml` does not exist yet, `src-tauri/src/lib.rs` copies it over once without overwriting existing destination files. Reads and settings updates use that same YAML file on every launch, regardless of the launch directory.

- macOS: `~/Library/Application Support/zip.kizuna.donate/config.yaml`
- Windows: `%APPDATA%\dethz-lab\dethz-socket\config.yaml`
- Linux: `~/.local/share/zip.kizuna.donate/config.yaml` (or the directory selected by `XDG_DATA_HOME`).

Existing YAML files are not replaced by bundled defaults. To move an existing development configuration into the desktop app, close the app and copy your `config.yaml` to this location before launching. Keep it private: it can contain Spotify credentials and private overlay URLs. Back up an existing destination before replacing it.

Development and standalone server commands continue using the working directory's `config.yaml`. For a standalone server with a fixed location, set `DONATE_CONFIG_FILE` to the absolute YAML path. `DONATE_CONFIG_TEMPLATE` optionally supplies first-run defaults; it never replaces an existing file. Configuration writes use atomic replacement, and the settings API reports failed saves instead of claiming success.

---

## 4. Automated Multi-OS GitHub Workflow

The repository includes an automated GitHub Actions workflow at [`.github/workflows/release.yml`](../.github/workflows/release.yml) using Node 24 (`actions/checkout@v7`, `actions/setup-node@v7`) and Bun (`oven-sh/setup-bun@v2`).

### Build Matrix
The workflow builds across clean virtual environments for:
1. **macOS (`macos-15`)**: builds both `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel)
2. **Linux (`ubuntu-22.04`)**: x86_64 `.deb`, `.rpm`, and `.AppImage`
3. **Windows (`windows-latest`)**: x86_64 `.msi`, `-setup.exe`, and `donate-socket_<version>_x64-portable.zip` (staging `donate-socket.exe`, `backend/donate-server.exe`, `config.example.yaml`, and `overlays/`, reading `VERSION` via step `env:`)

### Trigger Conditions
- **Git Tags**: Any tag pushed matching `v*` (e.g. `git tag v1.0.0 && git push origin v1.0.0`).
- **Version Bump on `main`**: Any push to `main` where `version` in `package.json` / `tauri.conf.json` has been updated and no matching Git tag exists yet. (If the tag already exists, the build is skipped to conserve runner minutes).
- **Manual Trigger**: Can be manually run via the GitHub Actions **Run workflow** button with an optional `force_release` toggle.

### Release Notes
The workflow automatically checks for a matching release note file at `RELEASED_NOTE/{version}.md` (or `RELEASED_NOTE/v{version}.md`) and uses its contents as the GitHub Release body.
