import { afterAll, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "donate-security-test-"));
process.env.DONATE_CONFIG_FILE = path.join(tempDir, "config.yaml");

const { validateWebhookUrl } = await import("../server/services/webhook.ts");
const {
  getLanAddresses,
  HOST,
  isAllowedOrigin,
  isLoopbackAddress,
  isPrivateOrLanHost,
  parseJsonBody,
  parseRequestUrl,
} = await import("../server/utils.ts");
const { isValidExternalLayerUrl } = await import("../server/config.ts");
const { validateRemoteRepoUrl } = await import("../server/services/overlays.ts");
const { buildSSML } = await import("../server/services/tts.ts");
const { handleSpotifyRoutes } = await import("../server/routes/spotify.ts");
const { handleOverlayRoutes } = await import("../server/routes/overlays.ts");
const { handleStatusRoutes, MAX_STATUS_SSE_CLIENTS } = await import("../server/routes/status.ts");
const { spotifyState, sseClients } = await import("../server/state.ts");
const { resolveApiBase } = await import("../src/lib/apiBase.ts");

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

class MockRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  writeHead(code: number, h?: Record<string, string>) {
    this.statusCode = code;
    if (h) Object.assign(this.headers, h);
    return this;
  }
  end(chunk?: string) {
    if (chunk) this.body += chunk;
    return this;
  }
}

describe("webhook URL validation", () => {
  test("blocks bracketed IPv6 link-local, metadata, self LAN API port, and IPv4-mapped loopback URLs", () => {
    const blocked = [
      "http://[fe80::1]/hook",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:127.0.0.1]:3001/api/connect",
      "http://[::ffff:127.0.0.2]:3001/api/connect",
      "http://[::]:3001/api/connect",
    ];
    for (const lanIp of getLanAddresses()) {
      blocked.push(`http://${lanIp}:3001/api/connect`);
    }
    for (const url of blocked) {
      expect(() => validateWebhookUrl(url)).toThrow();
      expect(isValidExternalLayerUrl(url)).toBe(false);
    }
    expect(() => validateWebhookUrl("https://hooks.example.test/tiktok")).not.toThrow();
    expect(isValidExternalLayerUrl("https://hooks.example.test/overlay")).toBe(true);
    const lanIp = getLanAddresses()[0];
    if (lanIp) {
      expect(isValidExternalLayerUrl(`http://${lanIp}:8080/widget`)).toBe(true);
    }
  });
});

describe("LAN binding and origin/API helpers", () => {
  test("defaults bridge listen host to 0.0.0.0", () => {
    expect(HOST).toBe(process.env.HOST || "0.0.0.0");
  });

  test("allows loopback, RFC1918/ULA LAN, and .local hosts while rejecting public and link-local hosts", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.50",
      "stream-pc.local",
      "[fd12:3456::1]",
    ]) {
      expect(isPrivateOrLanHost(h)).toBe(true);
    }

    for (const h of [
      "",
      "evil.com",
      "8.8.8.8",
      "169.254.169.254",
      "[fe80::1]",
      "172.15.0.1",
      "172.32.0.1",
      "192.169.1.1",
      "999.0.0.1",
      "..local",
    ]) {
      expect(isPrivateOrLanHost(h)).toBe(false);
    }
  });

  test("resolves API_BASE for Tauri and LAN browser hosts", () => {
    expect(resolveApiBase({ protocol: "tauri:", hostname: "localhost" })).toBe("http://127.0.0.1:3001");
    expect(resolveApiBase({ protocol: "http:", hostname: "tauri.localhost" })).toBe("http://127.0.0.1:3001");
    expect(resolveApiBase({ protocol: "http:", hostname: "localhost" })).toBe("http://localhost:3001");
    expect(resolveApiBase({ protocol: "http:", hostname: "192.168.1.50" })).toBe("http://192.168.1.50:3001");
    expect(resolveApiBase({ protocol: "http:", hostname: "fd00::1" })).toBe("http://[fd00::1]:3001");
  });
});

describe("input, SSRF, SSML, OAuth, and local-folder hardening", () => {
  test("validates remote git/zip repository URLs and rejects unsafe schemes or local hosts", () => {
    for (const bad of [
      "ext::sh -c id",
      "file:///etc/passwd",
      "ssh://git@github.com/org/repo.git",
      "https://user:pass@github.com/org/repo",
      "http://127.0.0.1/repo.zip",
      "http://[::1]:3001/repo.zip",
      "http://169.254.169.254/latest/meta-data/",
      "http://[fd00:ec2::254]/meta",
    ]) {
      expect(() => validateRemoteRepoUrl(bad)).toThrow();
    }
    expect(validateRemoteRepoUrl("https://github.com/owner/repo").href).toBe("https://github.com/owner/repo");
  });

  test("prevents SSML attribute injection via voice, rate, and pitch", () => {
    const ssml = buildSSML("Hello <world>", 'en-US" /><speak>', '10%" bad="1', '5Hz" onclick="x');
    expect(ssml).toContain('<voice name="th-TH-NiwatNeural">');
    expect(ssml).toContain('rate="+0%"');
    expect(ssml).toContain('pitch="+0Hz"');
    expect(ssml).toContain("Hello &lt;world&gt;");
    expect(ssml).not.toContain('onclick="x');
  });

  test("enforces Spotify OAuth state presence and HTML-escapes callback errors", async () => {
    // Reject unsolicited callback when no login state is active
    const r1 = new MockRes();
    await handleSpotifyRoutes(
      { method: "GET" } as http.IncomingMessage,
      r1 as unknown as http.ServerResponse,
      new URL("http://127.0.0.1:3001/api/spotify/callback?code=abc&state=forged")
    );
    expect(r1.statusCode).toBe(403);

    // Initiate OAuth login to set expectedOAuthState, then return escaped error
    const prevCid = spotifyState.clientId;
    spotifyState.clientId = "test-client";
    const loginRes = new MockRes();
    await handleSpotifyRoutes(
      { method: "GET" } as http.IncomingMessage,
      loginRes as unknown as http.ServerResponse,
      new URL("http://127.0.0.1:3001/api/spotify/login")
    );
    const state = new URL(loginRes.headers.Location).searchParams.get("state");
    expect(state).toBeTruthy();

    const errRes = new MockRes();
    await handleSpotifyRoutes(
      { method: "GET" } as http.IncomingMessage,
      errRes as unknown as http.ServerResponse,
      new URL(`http://127.0.0.1:3001/api/spotify/callback?error=${encodeURIComponent("<img src=x onerror=alert(1)>")}&state=${state}`)
    );
    spotifyState.clientId = prevCid;
    expect(errRes.statusCode).toBe(400);
    expect(errRes.body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(errRes.body).not.toContain("<img ");
  });

  test("restricts open-folder route to loopback clients and enforces JSON body size cap", async () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.25")).toBe(false);

    const remoteRes = new MockRes();
    await handleOverlayRoutes(
      { method: "POST", socket: { remoteAddress: "192.168.1.25" } } as unknown as http.IncomingMessage,
      remoteRes as unknown as http.ServerResponse,
      new URL("http://192.168.1.10:3001/api/overlays/open-folder")
    );
    expect(remoteRes.statusCode).toBe(403);

    const req = new EventEmitter() as http.IncomingMessage & { destroy: () => void };
    let destroyed = false;
    req.destroy = () => {
      destroyed = true;
    };
    const bodyPromise = parseJsonBody(req);
    req.emit("data", Buffer.alloc(1024 * 1024 + 8, "a"));
    req.emit("end");
    await expect(bodyPromise).rejects.toThrow("Payload too large");
    expect(destroyed).toBe(true);
  });

  test("validates allowed CORS origins, handles malformed Host headers safely, and caps status SSE clients", async () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("tauri://localhost")).toBe(true);
    expect(isAllowedOrigin("http://localhost:1420")).toBe(true);
    expect(isAllowedOrigin("https://192.168.1.42:3002")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("javascript:alert(1)")).toBe(false);

    const safeParsed = parseRequestUrl({ url: "/api/status", headers: { host: "bad host:3001" } });
    expect(safeParsed?.pathname).toBe("/api/status");
    expect(parseRequestUrl({ url: "http://[::1", headers: { host: "localhost" } })).toBeNull();

    expect(MAX_STATUS_SSE_CLIENTS).toBe(100);
    const saved = [...sseClients];
    try {
      while (sseClients.length < MAX_STATUS_SSE_CLIENTS) {
        sseClients.push({} as unknown as http.ServerResponse);
      }
      const sseRes = new MockRes();
      const handled = await handleStatusRoutes(
        { method: "GET" } as http.IncomingMessage,
        sseRes as unknown as http.ServerResponse,
        new URL("http://127.0.0.1:3001/api/events")
      );
      expect(handled).toBe(true);
      expect(sseRes.statusCode).toBe(503);
    } finally {
      sseClients.length = 0;
      sseClients.push(...saved);
    }
  });

  test("rejects malformed percent encoding and symlink traversal in /overlays/* static handler", async () => {
    const badEncodingRes = new MockRes();
    const handledBad = await handleOverlayRoutes(
      { method: "GET" } as http.IncomingMessage,
      badEncodingRes as unknown as http.ServerResponse,
      new URL("http://127.0.0.1:3001/overlays/%E0%A4%A")
    );
    expect(handledBad).toBe(true);
    expect(badEncodingRes.statusCode).toBe(400);

    const sandboxRoot = fs.mkdtempSync(path.join(tempDir, "overlay-symlink-test-"));
    const overlaysDir = path.join(sandboxRoot, "overlays");
    fs.mkdirSync(overlaysDir, { recursive: true });
    const outsideSecret = path.join(sandboxRoot, "secret.txt");
    fs.writeFileSync(outsideSecret, "TOP_SECRET_VALUE", "utf-8");
    const okFile = path.join(overlaysDir, "ok.txt");
    fs.writeFileSync(okFile, "SAFE_ASSET", "utf-8");
    fs.symlinkSync(outsideSecret, path.join(overlaysDir, "leak.txt"));
    fs.symlinkSync(sandboxRoot, path.join(overlaysDir, "escape-dir"));

    const overlaysRouteModule = path.resolve(import.meta.dir, "..", "server", "routes", "overlays.ts");
    const script = `
      const { handleOverlayRoutes } = await import(${JSON.stringify(overlaysRouteModule)});
      function runReq(p) {
        return new Promise((resolve) => {
          const res = {
            statusCode: 200,
            headers: {},
            body: "",
            writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this.headers, h); return this; },
            end(chunk) { if (chunk) this.body += chunk.toString(); resolve(this); return this; },
          };
          void handleOverlayRoutes({ method: "GET" }, res, new URL("http://127.0.0.1:3001" + p));
        });
      }
      const rOk = await runReq("/overlays/ok.txt");
      const rDirect = await runReq("/overlays/leak.txt");
      const rDir = await runReq("/overlays/escape-dir/secret.txt");
      console.log(JSON.stringify({
        ok: [rOk.statusCode, rOk.body],
        direct: [rDirect.statusCode, rDirect.body.includes("TOP_SECRET_VALUE")],
        dir: [rDir.statusCode, rDir.body.includes("TOP_SECRET_VALUE")],
      }));
      process.exit(0);
    `;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: sandboxRoot,
      env: { ...process.env, DONATE_CONFIG_FILE: path.join(sandboxRoot, "config.yaml") },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    expect(child.exitCode).toBe(0);
    const parsed = JSON.parse(child.stdout.toString().trim());
    expect(parsed.ok).toEqual([200, "SAFE_ASSET"]);
    expect(parsed.direct).toEqual([403, false]);
    expect(parsed.dir).toEqual([403, false]);
  }, 15_000);
});
