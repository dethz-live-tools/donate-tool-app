# Security Audit & AI Pentesting Guide

## 1. Vulnerability Audit & Codebase Hardening

A comprehensive source-code security audit was conducted on `donate-tools-pc`. The following vulnerabilities were identified and hardened:

### 1.1 Path Traversal in Static Overlay Server
- **Vulnerability**: `server/routes/overlays.ts` checked `!targetPath.startsWith(OVERLAYS_DIR)`. Without path boundary separator checks, paths matching partial directory names could bypass the prefix condition.
- **Remediation**: Implemented `path.relative` checking (`relative.startsWith("..") || path.isAbsolute(relative)`) and strict boundary enforcement (`OVERLAYS_DIR + path.sep`).

### 1.2 Arbitrary Directory Deletion in Overlay Manager
- **Vulnerability**: `server/services/overlays.ts` used `path.basename(overlayId)`. If an empty string or root path was passed, `path.join(OVERLAYS_DIR, "")` resolved to `OVERLAYS_DIR` itself, risking recursive deletion of all installed overlays.
- **Remediation**: Enforced strict alphanumeric regex validation (`/^[a-zA-Z0-9_-]+$/`), prevented target resolution equal to `OVERLAYS_DIR`, and verified parent boundary constraints before deletion.

### 1.3 Stored HTML Injection / XSS in Custom Overlay Generator
- **Vulnerability**: `server/services/overlays.ts` interpolated user-provided `data.name` directly into HTML template tags (`<title>${meta.name}</title>`, `<h2>${meta.name}</h2>`).
- **Remediation**: Added `escapeHtml()` sanitization encoding `<`, `>`, `"`, `'`, and `&` before template generation.

### 1.4 SSRF & Protocol Validation on Webhook Dispatch
- **Vulnerability**: `server/services/webhook.ts` accepted any URI string without protocol constraints.
- **Remediation**: Enforced `URL` parser checks ensuring only `http:` and `https:` schemes can be dispatched.

### 1.5 CORS Method Header Misconfiguration
- **Vulnerability**: `server/index.ts` only announced `GET, POST, OPTIONS` in `Access-Control-Allow-Methods`, breaking RESTful `DELETE` and `PUT` requests from external dashboard integrations.
- **Remediation**: Updated to `GET, POST, PUT, DELETE, HEAD, OPTIONS`.

### 1.6 Spotify OAuth CSRF State Verification
- **Vulnerability**: `server/routes/spotify.ts` initiated Spotify authorization without an anti-CSRF `state` parameter.
- **Remediation**: Implemented cryptographically generated one-time `state` parameter generated on `/api/spotify/login` and strictly validated on `/api/spotify/callback`.

### 1.7 Expanded Loopback, IPv6, Link-Local & Metadata SSRF Protection
- **Vulnerability**: Initial URL checks did not cover all loopback ranges (`127.0.0.0/8`), unspecified hosts (`0.0.0.0`, `[::]`), bracketed IPv6 / IPv4-mapped IPv6 addresses (`[::ffff:127.0.0.1]`, `[fe80::1]`, `[fd00:ec2::254]`, `[::ffff:169.254.169.254]`), embedded URL credentials, or HTTP redirect chains.
- **Remediation**: Extracted shared `classifyBlockedHost()` in `server/utils.ts` (stripping IPv6 brackets and classifying metadata/link-local vs loopback hosts) and enforced it in `validateWebhookUrl()` (`server/services/webhook.ts`, alongside `redirect: "error"` on `fetch()`), `isValidExternalLayerUrl()` (`server/config.ts`), `STUDIO_OBS_HTML` (`server/routes/overlays.ts`), and `handleAddExternalLayer()` (`src/components/StudioTab.tsx`), covered by `tests/security.test.ts` and `server/studio.test.ts`.

### 1.8 CORS Origin Allowlist
- **Vulnerability / Exposure**: External web pages visited in the same browser should not be able to query or mutate `http://127.0.0.1:3001/api/*`.
- **Remediation**: `isAllowedOrigin()` in `server/index.ts` restricts browser `Origin` headers to `tauri:` / `tauri.localhost` and loopback hosts (`localhost`, `127.0.0.1`, `::1`, `[::1]`), returning HTTP `403` for untrusted cross-origin `/api/*` requests and preflights.

### 1.9 Single-Pass TTS Template Substitution
- **Vulnerability**: Sequential string replacements in TTS templates could re-substitute placeholders injected inside `{nickname}` or `{username}` with the viewer's `{comment}`.
- **Remediation**: `server/services/tiktok.ts` performs single-pass substitution using `.replace(/\{(nickname|username|comment)\}/g, ...)`.

### 1.10 Prototype-Safe i18n Dictionary Lookup
- **Vulnerability**: Direct property indexing on `dictionaries[lang]` returned `Object.prototype` functions for keys such as `toString` or `constructor`.
- **Remediation**: `tFor()` in `src/i18n.tsx` checks `Object.prototype.hasOwnProperty.call(dict, key)` before resolving localized strings (`tests/i18n.test.ts`).

### 1.11 CI Audit Enforcement & Workflow Expression Context Hardening
- **Vulnerability**: `.github/workflows/security.yml` masked dependency audit failures (`bun pm audit || echo ...`), and `.github/workflows/release.yml` interpolated `${{ needs.check-version.outputs.version }}` directly inside an inline PowerShell script.
- **Remediation**: Switched dependency scanning to failing `bun audit` on Node 24/Bun workflow actions, and moved `VERSION: ${{ needs.check-version.outputs.version }}` into step `env:` (`$env:VERSION`).

---

## 2. CI/CD Automated Security Scanning & Verification

Automated security checks are configured in [`.github/workflows/security.yml`](../.github/workflows/security.yml):
- **CodeQL Static Analysis**: Scans TypeScript/JavaScript (`actions/checkout@v7`, `github/codeql-action/*@v4`).
- **Dependency Audit**: Runs `bun install --frozen-lockfile` followed by `bun audit` (`oven-sh/setup-bun@v2`).
- **Shannon AI Autonomous Scanner**: Runs on push to `main` or weekly schedule when `SHANNON_AI_API_KEY` secret is configured.

Local verification commands:
```bash
bun audit
bun test
cd src-tauri && cargo test
```

---

## 3. Running Shannon AI Pentester Locally

Shannon (`KeygraphHQ/shannon`) runs autonomous vulnerability analysis inside an ephemeral Docker container.

### Prerequisites
1. Docker Desktop installed and running.
2. Local application running on port 3001:
   ```bash
   bun run server
   ```

### Setup & Execution
```bash
# 1. Configure AI provider credentials (bring your own API key)
npx @keygraph/shannon@latest setup

# 2. Run autonomous pentest against local app
# Note: Docker container cannot reach host 'localhost' directly; use host.docker.internal
npx @keygraph/shannon@latest start \
  -u http://host.docker.internal:3001 \
  -r ./
```

Shannon will:
1. Conduct reconnaissance and route discovery across all API endpoints.
2. Test attack categories (injection, XSS, SSRF, auth boundaries, input validation).
3. Generate a proof-of-concept report and SARIF vulnerability output.
