import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { normalizeStudioScene } from "./config.ts";

function runIsolatedStudio(code: string) {
  const cwd = fs.mkdtempSync(path.join(process.cwd(), ".studio-test-"));
  try {
    const result = Bun.spawnSync([process.execPath, "-e", `
      import assert from "node:assert/strict";
      import fs from "node:fs";
      import { createServer } from "node:http";
      import { once } from "node:events";
      import vm from "node:vm";
      import { CONFIG_FILE, LEGACY_CONFIG_FILE, loadConfig, saveConfig } from ${JSON.stringify(import.meta.resolve("./config.ts"))};
      import { handleOverlayRoutes } from ${JSON.stringify(import.meta.resolve("./routes/overlays.ts"))};
      import { createCustomOverlay, deleteOverlay } from ${JSON.stringify(import.meta.resolve("./services/overlays.ts"))};
      import { sseClients } from ${JSON.stringify(import.meta.resolve("./state.ts"))};
      const server = createServer((req, res) => {
        handleOverlayRoutes(req, res, new URL(req.url, "http://localhost"))
          .then((handled) => { if (!handled) { res.writeHead(404); res.end(); } })
          .catch((error) => { res.writeHead(500); res.end(String(error)); });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = "http://127.0.0.1:" + server.address().port;
      async function request(url, body, method = body === undefined ? "GET" : "POST") {
        const response = await fetch(base + url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      }
      try {
        ${code}
        process.exit(0);
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
    `], { cwd, stdout: "pipe", stderr: "pipe", timeout: 15000 });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr) || new TextDecoder().decode(result.stdout));
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe("Overlay Studio normalization & safety", () => {
  test("returns default 1920x1080 empty scene for invalid input", () => {
    expect(normalizeStudioScene(null)).toEqual({
      width: 1920,
      height: 1080,
      layers: [],
    });
    expect(normalizeStudioScene("bad")).toEqual({
      width: 1920,
      height: 1080,
      layers: [],
    });
  });

  test("clamps dimensions, filters studio self-reference, and sanitizes layer fields", () => {
    const result = normalizeStudioScene({
      width: 99999,
      height: 100,
      layers: [
        { overlayId: "studio", id: "recursive" },
        {
          id: "l1",
          overlayId: "spotify-card/../evil",
          name: "Spotify Widget",
          x: 120.7,
          y: -15.2,
          width: 10,
          height: 5,
          scale: 12,
          opacity: -1,
          zIndex: 3,
          visible: false,
          locked: 1,
        },
      ],
    });

    expect(result.width).toBe(7680);
    expect(result.height).toBe(240);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toEqual({
      id: "l1",
      overlayId: "spotify-cardevil",
      name: "Spotify Widget",
      x: 121,
      y: -15,
      width: 40,
      height: 20,
      scale: 5,
      opacity: 0,
      zIndex: 3,
      visible: false,
      locked: true,
    });
  });

  test("guards reserved 'studio' ID when creating custom overlays", () => {
    runIsolatedStudio(`
      const created = createCustomOverlay({ id: "studio", name: "Attempt Reserved ID" });
      try {
        assert.equal(created.id, "custom-studio");
      } finally {
        deleteOverlay(created.id);
      }
    `);
  });
});

describe("Named Studio profiles", () => {
  test("persists normalized profile scenes without changing master or unrelated config", () => {
    runIsolatedStudio(`
      const master = { width: 1920, height: 1080, layers: [] };
      saveConfig({ username: "legacy-user", spotifyClientSecret: "keep-secret", studio: master });
      assert.deepEqual(await request("/api/overlays/studio/profiles"), {
        status: 200, body: { success: true, profiles: [] },
      });
      const created = await request("/api/overlays/studio/profiles", {
        name: "  Gameplay  ", scene: { width: 99999, height: 1, layers: [{ overlayId: "studio" }] },
        id: "client-id-is-ignored",
      });
      assert.equal(created.status, 200);
      assert.equal(created.body.success, true);
      const profile = created.body.profile;
      assert.match(profile.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(profile.name, "Gameplay");
      assert.deepEqual(profile.scene, { width: 7680, height: 240, layers: [] });
      assert.deepEqual(created.body.profiles, [profile]);
      assert.deepEqual(loadConfig().studioProfiles, [profile]);
      assert.match(fs.readFileSync(CONFIG_FILE, "utf8"), /studioProfiles:/);
      saveConfig({ webhookUri: "https://example.test/webhook" });
      assert.deepEqual(loadConfig().studioProfiles, [profile]);
      assert.deepEqual((await request("/api/overlays/studio/profiles")).body.profiles, [profile]);
      assert.deepEqual((await request("/api/overlays/studio?profile=" + profile.id)).body.studio, profile.scene);
      assert.deepEqual((await request("/api/overlays/studio")).body.studio, master);
      assert.equal(loadConfig().username, "legacy-user");
      assert.equal(loadConfig().spotifyClientSecret, "keep-secret");
    `);
  });

  test("normalizes persisted profile scenes and ignores malformed profiles", () => {
    runIsolatedStudio(`
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({
        studio: { width: 1280, height: 720, layers: [] },
        studioProfiles: [
          { id: "saved", name: "  Saved  ", scene: { width: 99999, height: 100, layers: [{ overlayId: "studio" }] } },
          { id: "bad-scene", name: "Bad", scene: [] },
          { id: "bad-name", name: " ", scene: {} },
          { id: 12, name: "Bad ID", scene: {} },
        ],
      }));
      assert.deepEqual(loadConfig().studioProfiles, [{
        id: "saved", name: "Saved", scene: { width: 7680, height: 240, layers: [] },
      }]);
      assert.deepEqual(loadConfig().studio, { width: 1280, height: 720, layers: [] });
    `);
  });

  test("updates only the selected profile and preserves profiles on master writes", () => {
    runIsolatedStudio(`
      const master = { width: 1920, height: 1080, layers: [] };
      saveConfig({ studio: master });
      const first = (await request("/api/overlays/studio/profiles", { name: "First", scene: { width: 800, height: 600 } })).body.profile;
      const second = (await request("/api/overlays/studio/profiles", { name: "Second", scene: { width: 900, height: 700 } })).body.profile;
      const updated = { width: 1280, height: 720, layers: [] };
      const response = await request("/api/overlays/studio?profile=" + first.id, { studio: updated });
      assert.deepEqual(response, { status: 200, body: { success: true, studio: updated } });
      assert.deepEqual((await request("/api/overlays/studio?profile=" + second.id)).body.studio, second.scene);
      assert.deepEqual((await request("/api/overlays/studio")).body.studio, master);
      assert.equal(loadConfig().studioProfiles[0].name, "First");
      assert.deepEqual(loadConfig().studioProfiles[0].scene, updated);
      const changedMaster = { width: 1600, height: 900, layers: [] };
      assert.equal((await request("/api/overlays/studio", changedMaster)).status, 200);
      assert.deepEqual(loadConfig().studio, changedMaster);
      assert.deepEqual(loadConfig().studioProfiles.map((profile) => profile.scene), [updated, second.scene]);
    `);
  });

  test("rejects unknown profile IDs and invalid payloads without changing saved scenes", () => {
    runIsolatedStudio(`
      saveConfig({ studio: { width: 1920, height: 1080, layers: [] } });
      const before = fs.readFileSync(CONFIG_FILE, "utf8");
      for (const name of [undefined, null, "", "   ", 123, "x".repeat(101)]) {
        const response = await request("/api/overlays/studio/profiles", { name, scene: {} });
        assert.equal(response.status, 400);
        assert.equal(response.body.success, false);
      }
      for (const scene of [undefined, null, [], "bad", 12, false]) {
        assert.equal((await request("/api/overlays/studio/profiles", { name: "Invalid", scene })).status, 400);
      }
      for (const studio of [null, [], "bad", 12, false]) {
        assert.equal((await request("/api/overlays/studio", { studio })).status, 400);
      }
      for (const id of ["missing", ""]) {
        const url = "/api/overlays/studio?profile=" + id;
        assert.equal((await request(url)).status, 404);
        assert.equal((await request(url, { studio: {} })).status, 404);
        assert.equal((await fetch(base + "/overlays/studio/?profile=" + id)).status, 404);
      }
      assert.equal(fs.readFileSync(CONFIG_FILE, "utf8"), before);
      const profile = (await request("/api/overlays/studio/profiles", { name: "x".repeat(100), scene: {} })).body.profile;
      const saved = fs.readFileSync(CONFIG_FILE, "utf8");
      for (const studio of [undefined, null, [], "bad"]) {
        assert.equal((await request("/api/overlays/studio?profile=" + profile.id, { studio })).status, 400);
      }
      assert.equal((await request("/api/overlays/studio?profile=" + profile.id, { width: 800 })).status, 400);
      assert.equal(fs.readFileSync(CONFIG_FILE, "utf8"), saved);
    `);
  });

  test("migrates legacy configuration without inventing or replacing master profiles", () => {
    runIsolatedStudio(`
      fs.writeFileSync(LEGACY_CONFIG_FILE, JSON.stringify({ username: "legacy", spotifyClientSecret: "secret" }));
      const migrated = loadConfig();
      assert.equal(migrated.username, "legacy");
      assert.equal(migrated.spotifyClientSecret, "secret");
      assert.deepEqual(migrated.studioProfiles, []);
      assert.deepEqual(migrated.studio, { width: 1920, height: 1080, layers: [] });
      assert.deepEqual(loadConfig(), migrated);
    `);
  });

  test("OBS runtime keeps each profile selected through live SSE updates", () => {
    runIsolatedStudio(`
      saveConfig({ studio: { width: 1920, height: 1080, layers: [] } });
      const first = (await request("/api/overlays/studio/profiles", { name: "First", scene: { width: 800, height: 600 } })).body.profile;
      const second = (await request("/api/overlays/studio/profiles", { name: "Second", scene: { width: 900, height: 700 } })).body.profile;
      const html = await (await fetch(base + "/overlays/studio/?profile=" + first.id)).text();
      const script = html.split("<script>")[1].split("</script>")[0];
      async function runtime(profile) {
        const rendered = Promise.withResolvers();
        const stage = { style: new Proxy({}, {
          set(target, property, value) {
            target[property] = value;
            if (property === "width") rendered.resolve();
            return true;
          },
        }) };
        let events;
        const context = {
          document: { getElementById: () => stage },
          window: { location: { search: profile ? "?profile=" + profile.id : "" }, innerWidth: 1920, innerHeight: 1080, addEventListener() {} },
          URLSearchParams,
          fetch: (url) => {
            assert.equal(url, "/api/overlays/studio" + (profile ? "?profile=" + profile.id : ""));
            return fetch(base + url).catch((error) => { rendered.reject(error); throw error; });
          },
          EventSource: class { constructor(url) { assert.equal(url, "/api/events"); events = this; } },
          setTimeout() { throw new Error("Unexpected SSE reconnect"); },
        };
        vm.runInNewContext(script, context);
        await rendered.promise;
        return { stage, update(data) { events.onmessage({ data: JSON.stringify(data) }); } };
      }
      const a = await runtime(first);
      const b = await runtime(second);
      const master = await runtime();
      assert.equal(a.stage.style.width, "800px");
      assert.equal(b.stage.style.width, "900px");
      assert.equal(master.stage.style.width, "1920px");
      const messages = [];
      sseClients.push({ write(message) { messages.push(JSON.parse(message.slice(6))); } });
      await request("/api/overlays/studio?profile=" + first.id, { studio: { width: 1280, height: 720, layers: [] } });
      assert.equal(messages.length, 1);
      for (const page of [a, b, master]) page.update(messages[0]);
      assert.equal(a.stage.style.width, "1280px");
      assert.equal(b.stage.style.width, "900px");
      assert.equal(master.stage.style.width, "1920px");
      await request("/api/overlays/studio", { studio: { width: 1600, height: 900, layers: [] } });
      for (const page of [a, b, master]) page.update(messages[1]);
      assert.equal(a.stage.style.width, "1280px");
      assert.equal(b.stage.style.width, "900px");
      assert.equal(master.stage.style.width, "1600px");
    `);
  });
});
