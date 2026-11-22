import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "donate-screen-share-test-"));
process.env.DONATE_CONFIG_FILE = path.join(tempDir, "config.yaml");

const { getPublicConfig, loadConfig, saveConfig } = await import("./config.ts");
const {
  _resetScreenShareForTest,
  disconnectActiveSession,
  getScreenShareStatus,
  handleWhipRequest,
  markSessionConnected,
  MAX_WHIP_CLIENT_SOCKETS,
  parseTrickleIceSdpFrag,
  registerReceiverPeer,
  relayMirrorAnswer,
  relayMirrorOffer,
  submitWhipAnswer,
  unregisterReceiverPeer,
  verifyBearerToken,
} = await import("./services/screenShare.ts");
const { handleScreenShareRoutes } = await import("./routes/screenShare.ts");
const { generateSelfSignedCert, loadOrCreateScreenShareTlsCert } = await import("./services/tlsCert.ts");

interface RecordedEvent {
  event: string;
  data: any;
}

class MockSseResponse {
  chunks: string[] = [];
  events: RecordedEvent[] = [];

  write(chunk: string) {
    this.chunks.push(chunk);
    const match = chunk.match(/^event:\s*([^\n]+)\ndata:\s*([^\n]+)\n\n$/);
    if (match) {
      this.events.push({ event: match[1], data: JSON.parse(match[2]) });
    }
    return true;
  }
}

class MockHttpRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };

  constructor(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string
  ) {
    super();
    this.method = method;
    this.url = url;
    this.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    this.socket = { remoteAddress: "::ffff:192.168.1.42" };

    if (body !== undefined) {
      queueMicrotask(() => {
        if (body.length > 0) this.emit("data", Buffer.from(body));
        this.emit("end");
      });
    } else {
      queueMicrotask(() => this.emit("end"));
    }
  }
}

class MockHttpResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  headersSent = false;
  body = "";
  private resolveDone!: () => void;
  done: Promise<void>;

  constructor() {
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(statusCode: number, headers?: Record<string, string>) {
    this.statusCode = statusCode;
    this.headersSent = true;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this.headers[k.toLowerCase()] = v;
      }
    }
    return this;
  }

  end(chunk?: string) {
    if (chunk !== undefined) this.body += chunk;
    this.resolveDone();
    return this;
  }
}

const SAMPLE_OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
const SAMPLE_ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
const TEST_TOKEN = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  _resetScreenShareForTest({ token: TEST_TOKEN, port: 3002 });
});

afterAll(() => {
  _resetScreenShareForTest();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("WHIP Screen Share Receiver", () => {
  test("verifies bearer tokens safely and rejects invalid headers", () => {
    expect(verifyBearerToken(`Bearer ${TEST_TOKEN}`, TEST_TOKEN)).toBe(true);
    expect(verifyBearerToken(`bearer ${TEST_TOKEN}`, TEST_TOKEN)).toBe(true);
    expect(verifyBearerToken("Bearer wrong-token", TEST_TOKEN)).toBe(false);
    expect(verifyBearerToken("Basic abc", TEST_TOKEN)).toBe(false);
    expect(verifyBearerToken(undefined, TEST_TOKEN)).toBe(false);
    expect(verifyBearerToken(`Bearer ${TEST_TOKEN}`, "")).toBe(false);
  });

  test("parses RFC 8840 trickle-ice-sdpfrag candidates with mid and m-line index", () => {
    const frag = [
      "a=ice-ufrag:abcd",
      "a=ice-pwd:efgh",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=mid:0",
      "a=candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host",
      "a=end-of-candidates",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=mid:1",
      "a=candidate:2 1 udp 2122260223 192.168.1.42 54322 typ host",
    ].join("\r\n");

    expect(parseTrickleIceSdpFrag(frag)).toEqual([
      {
        candidate: "candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
      {
        candidate: "candidate:2 1 udp 2122260223 192.168.1.42 54322 typ host",
        sdpMid: "1",
        sdpMLineIndex: 1,
      },
    ]);
  });

  test("rejects unauthenticated, unsupported media type, malformed SDP, and missing receiver", async () => {
    // 401 unauthorized
    const r1 = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest("POST", "/whip", { "content-type": "application/sdp" }, SAMPLE_OFFER) as unknown as http.IncomingMessage,
      r1 as unknown as http.ServerResponse
    );
    expect(r1.statusCode).toBe(401);
    expect(r1.headers["www-authenticate"]).toBe("Bearer");

    // 415 wrong content type
    const r2 = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "POST",
        "/whip",
        { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/json" },
        "{}"
      ) as unknown as http.IncomingMessage,
      r2 as unknown as http.ServerResponse
    );
    expect(r2.statusCode).toBe(415);

    // 400 invalid SDP
    const r3 = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "POST",
        "/whip",
        { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/sdp" },
        "not-an-sdp"
      ) as unknown as http.IncomingMessage,
      r3 as unknown as http.ServerResponse
    );
    expect(r3.statusCode).toBe(400);

    // 503 when no receiver peer is open
    const r4 = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "POST",
        "/whip",
        { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/sdp" },
        SAMPLE_OFFER
      ) as unknown as http.IncomingMessage,
      r4 as unknown as http.ServerResponse
    );
    expect(r4.statusCode).toBe(503);
  });

  test("completes WHIP POST -> PATCH trickle ICE -> mirror -> DELETE lifecycle and prefers app primary", async () => {
    const obsSse = new MockSseResponse();
    const appSse = new MockSseResponse();
    const obsId = registerReceiverPeer("obs", obsSse as unknown as http.ServerResponse);
    const appId = registerReceiverPeer("app", appSse as unknown as http.ServerResponse);

    // OBS peers must never receive the cleartext WHIP Bearer token
    expect(obsSse.events.find((e) => e.event === "welcome")?.data.status.token).toBe("");
    expect(appSse.events.find((e) => e.event === "welcome")?.data.status.token).toBe(TEST_TOKEN);

    const postRes = new MockHttpResponse();
    const postPromise = handleWhipRequest(
      new MockHttpRequest(
        "POST",
        "/whip",
        { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/sdp" },
        SAMPLE_OFFER
      ) as unknown as http.IncomingMessage,
      postRes as unknown as http.ServerResponse
    );

    await Promise.resolve();
    await Promise.resolve();

    // App peer should be chosen as primary over OBS
    const offerEvent = appSse.events.find((e) => e.event === "whip-offer");
    expect(offerEvent).toBeDefined();
    expect(obsSse.events.find((e) => e.event === "whip-offer")).toBeUndefined();

    const sessionId: string = offerEvent!.data.sessionId;
    expect(submitWhipAnswer(sessionId, appId, SAMPLE_ANSWER).ok).toBe(true);

    await postPromise;
    expect(postRes.statusCode).toBe(201);
    expect(postRes.headers["content-type"]).toBe("application/sdp");
    expect(postRes.headers.location).toBe(`/whip/${sessionId}`);
    expect(postRes.headers.etag).toMatch(/^"[0-9a-f]+"$/);
    expect(postRes.body).toBe(SAMPLE_ANSWER);

    // PATCH with wrong ETag -> 412
    const badPatchRes = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "PATCH",
        `/whip/${sessionId}`,
        {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/trickle-ice-sdpfrag",
          "if-match": '"wrong-etag"',
        },
        "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=candidate:1 1 udp 1 192.168.1.42 5000 typ host\r\n"
      ) as unknown as http.IncomingMessage,
      badPatchRes as unknown as http.ServerResponse
    );
    expect(badPatchRes.statusCode).toBe(412);

    // PATCH with valid ETag -> 204 and forwards candidate to primary
    const patchRes = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "PATCH",
        `/whip/${sessionId}`,
        {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/trickle-ice-sdpfrag",
          "if-match": postRes.headers.etag,
        },
        "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=candidate:1 1 udp 1 192.168.1.42 5000 typ host\r\n"
      ) as unknown as http.IncomingMessage,
      patchRes as unknown as http.ServerResponse
    );
    expect(patchRes.statusCode).toBe(204);
    const iceEvent = appSse.events.find((e) => e.event === "whip-ice");
    expect(iceEvent?.data.candidates).toHaveLength(1);

    // Primary marks connected -> requests mirror to waiting OBS viewer
    expect(markSessionConnected(sessionId, appId, { width: 1920, height: 1080, hasAudio: true })).toBe(true);
    const mirrorStart = appSse.events.find((e) => e.event === "mirror-start");
    expect(mirrorStart?.data).toEqual({ sessionId, viewerId: obsId });
    expect(getScreenShareStatus().activeSession?.width).toBe(1920);

    // Relay mirror offer/answer between app (primary) and obs (viewer)
    expect(relayMirrorOffer(sessionId, appId, obsId, SAMPLE_OFFER)).toBe(true);
    expect(obsSse.events.find((e) => e.event === "mirror-offer")?.data.sdp).toBe(SAMPLE_OFFER);
    expect(relayMirrorAnswer(sessionId, obsId, SAMPLE_ANSWER)).toBe(true);
    expect(appSse.events.find((e) => e.event === "mirror-answer")?.data.sdp).toBe(SAMPLE_ANSWER);

    // Secondary viewer disconnect notifies primary to close mirror PC
    unregisterReceiverPeer(obsId);
    expect(appSse.events.find((e) => e.event === "mirror-stop")?.data.viewerId).toBe(obsId);

    // DELETE tears down session cleanly
    const delRes = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "DELETE",
        `/whip/${sessionId}`,
        { authorization: `Bearer ${TEST_TOKEN}` }
      ) as unknown as http.IncomingMessage,
      delRes as unknown as http.ServerResponse
    );
    expect(delRes.statusCode).toBe(200);
    expect(getScreenShareStatus().activeSession).toBeNull();
    expect(appSse.events.some((e) => e.event === "session-ended")).toBe(true);

    // Second DELETE -> 404
    const delAgain = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "DELETE",
        `/whip/${sessionId}`,
        { authorization: `Bearer ${TEST_TOKEN}` }
      ) as unknown as http.IncomingMessage,
      delAgain as unknown as http.ServerResponse
    );
    expect(delAgain.statusCode).toBe(404);
  });

  test("serves OBS Browser Source overlay HTML at /overlays/screen-share/", async () => {
    const res = new MockHttpResponse();
    const handled = await handleScreenShareRoutes(
      new MockHttpRequest("GET", "/overlays/screen-share/") as unknown as http.IncomingMessage,
      res as unknown as http.ServerResponse,
      new URL("http://127.0.0.1:3001/overlays/screen-share/")
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("RTCPeerConnection");
    expect(res.body).toContain("/api/screen-share/events?role=obs");
    expect(res.body).toContain('id="volume-slider"');
    expect(res.body).toContain('id="mute-btn"');
    expect(res.body).toContain('id="logs-btn"');
    expect(res.body).toContain('id="log-panel"');
    expect(res.body).toContain("donate_socket_screen_share_vol");
    const obsScript = res.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(obsScript).toBeDefined();
    expect(() => new Function(obsScript!)).not.toThrow();
  });

  test("serves built-in HTTP web screen sharer at GET /share, /screen, and / without leaking token", async () => {
    for (const p of ["/share", "/screen", "/"]) {
      const res = new MockHttpResponse();
      await handleWhipRequest(
        new MockHttpRequest("GET", p) as unknown as http.IncomingMessage,
        res as unknown as http.ServerResponse
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.body).toContain("getDisplayMedia");
      expect(res.body).toContain('id="log-list"');
      expect(res.body).toContain('id="https-switch-link"');
      expect(res.body).toContain("/whip");
      expect(res.body).not.toContain(TEST_TOKEN);
      expect(res.body).not.toContain("__WHIP_PORT__");
      const sharerScript = res.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(sharerScript).toBeDefined();
      expect(() => new Function(sharerScript!)).not.toThrow();
    }

    const headRes = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest("HEAD", "/share") as unknown as http.IncomingMessage,
      headRes as unknown as http.ServerResponse
    );
    expect(headRes.statusCode).toBe(200);
    expect(headRes.body).toBe("");

    // Bridge port (3001) also serves /screen and /share directly
    for (const p of ["/screen", "/share"]) {
      const bridgeRes = new MockHttpResponse();
      const handled = await handleScreenShareRoutes(
        new MockHttpRequest("GET", p) as unknown as http.IncomingMessage,
        bridgeRes as unknown as http.ServerResponse,
        new URL(`http://127.0.0.1:3001${p}`)
      );
      expect(handled).toBe(true);
      expect(bridgeRes.statusCode).toBe(200);
      expect(bridgeRes.body).toContain("getDisplayMedia");
    }
    expect(getScreenShareStatus().apiRevision).toBe(5);
  });

  test("generates, persists, reuses, and refreshes self-signed TLS certs for LAN IPs", () => {
    const generated = generateSelfSignedCert(["192.168.1.34", "100.115.197.4"]);
    const x509 = new X509Certificate(generated.cert);
    expect(x509.checkPrivateKey(createPrivateKey(generated.key))).toBe(true);
    expect(x509.subjectAltName).toContain("DNS:localhost");
    expect(x509.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(x509.subjectAltName).toContain("IP Address:192.168.1.34");
    expect(x509.subjectAltName).toContain("IP Address:100.115.197.4");

    const certDir = path.join(tempDir, "tls");
    const first = loadOrCreateScreenShareTlsCert(["192.168.1.34"], certDir);
    const second = loadOrCreateScreenShareTlsCert(["192.168.1.34"], certDir);
    expect(second.fingerprint).toBe(first.fingerprint);

    // Adding a new LAN IP regenerates the cert with the new IP in SAN
    const refreshed = loadOrCreateScreenShareTlsCert(["192.168.1.34", "10.0.0.9"], certDir);
    expect(refreshed.fingerprint).not.toBe(first.fingerprint);
    expect(new X509Certificate(refreshed.cert).subjectAltName).toContain("IP Address:10.0.0.9");
  });

  test("masks screenShare token in public config and preserves it across saves", () => {
    expect(saveConfig({ screenShare: { enabled: true, port: 3005, token: "secret-whip-token" } })).toBe(true);
    const loaded = loadConfig();
    expect(loaded.screenShare).toEqual({ enabled: true, port: 3005, token: "secret-whip-token" });

    const pub = getPublicConfig(loaded);
    expect(pub.screenShare?.token).toBe("••••••••");

    // Saving masked placeholder must not clobber persisted secret
    expect(saveConfig({ screenShare: { enabled: false, port: 3005, token: "••••••••" } })).toBe(true);
    expect(loadConfig().screenShare).toEqual({ enabled: false, port: 3005, token: "secret-whip-token" });

    // Invalid port falls back to default 3002 (and cannot collide with bridge port 3001)
    expect(saveConfig({ screenShare: { enabled: false, port: 3001, token: "••••••••" } })).toBe(true);
    expect(loadConfig().screenShare?.port).toBe(3002);

    disconnectActiveSession();
  });

  test("restricts WHIP CORS to private/LAN origins, survives malformed Host, and guards TLS key symlinks", async () => {
    expect(MAX_WHIP_CLIENT_SOCKETS).toBe(100);

    // Untrusted public origin blocked from OPTIONS and POST /whip with no ACAO reflection
    const blockedOpt = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest("OPTIONS", "/whip", { origin: "https://evil.example" }) as unknown as http.IncomingMessage,
      blockedOpt as unknown as http.ServerResponse
    );
    expect(blockedOpt.statusCode).toBe(403);
    expect(blockedOpt.headers["access-control-allow-origin"]).toBeUndefined();

    const blockedPost = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest(
        "POST",
        "/whip",
        { origin: "https://evil.example", authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/sdp" },
        SAMPLE_OFFER
      ) as unknown as http.IncomingMessage,
      blockedPost as unknown as http.ServerResponse
    );
    expect(blockedPost.statusCode).toBe(403);
    expect(blockedPost.headers["access-control-allow-origin"]).toBeUndefined();

    const blockedGetShare = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest("GET", "/share", { origin: "https://evil.example" }) as unknown as http.IncomingMessage,
      blockedGetShare as unknown as http.ServerResponse
    );
    expect(blockedGetShare.headers["access-control-allow-origin"]).toBeUndefined();

    // Private LAN origin echoed cleanly on preflight
    const allowedOpt = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest("OPTIONS", "/whip", { origin: "https://192.168.1.42:3002" }) as unknown as http.IncomingMessage,
      allowedOpt as unknown as http.ServerResponse
    );
    expect(allowedOpt.statusCode).toBe(204);
    expect(allowedOpt.headers["access-control-allow-origin"]).toBe("https://192.168.1.42:3002");

    // Malformed Host header does not crash GET /share
    const malformedHostRes = new MockHttpResponse();
    await handleWhipRequest(
      new MockHttpRequest("GET", "/share", { host: "bad host:3002" }) as unknown as http.IncomingMessage,
      malformedHostRes as unknown as http.ServerResponse
    );
    expect(malformedHostRes.statusCode).toBe(200);

    // Symlinked TLS key/cert in certDir must be ignored and replaced safely without altering sentinel target
    const tlsDir = path.join(tempDir, "tls-symlink");
    fs.mkdirSync(tlsDir, { recursive: true });
    const sentinelPath = path.join(tempDir, "tls-sentinel.txt");
    fs.writeFileSync(sentinelPath, "DO_NOT_OVERWRITE", { mode: 0o644 });
    const existing = loadOrCreateScreenShareTlsCert(["192.168.1.34"], tlsDir);
    const keyPath = path.join(tlsDir, "screen-share-key.pem");
    fs.unlinkSync(keyPath);
    fs.symlinkSync(sentinelPath, keyPath);

    const rotated = loadOrCreateScreenShareTlsCert(["192.168.1.34"], tlsDir);
    expect(rotated.fingerprint).not.toBe(existing.fingerprint);
    expect(fs.readFileSync(sentinelPath, "utf-8")).toBe("DO_NOT_OVERWRITE");
    expect(fs.lstatSync(keyPath).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(keyPath).isFile()).toBe(true);
  });
});
