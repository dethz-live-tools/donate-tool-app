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

---

## 2. CI/CD Automated Security Scanning

Automated security checks are configured in [`.github/workflows/security.yml`](../.github/workflows/security.yml):
- **CodeQL Static Analysis**: Scans TypeScript/JavaScript for injection, insecure deserialization, and data-flow flaws.
- **Dependency Audit**: Audits npm/bun dependencies for known CVEs.
- **Shannon AI Autonomous Scanner**: Runs on `push` to `main` with SARIF upload to GitHub Security tab when `SHANNON_AI_API_KEY` secret is configured.

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
