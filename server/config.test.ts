import { describe, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function runIsolatedConfig(setup: string, code: string, override = true) {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".config-test-"));
  const cwd = path.join(root, "unrelated-cwd");
  const configFile = path.join(root, "app-data", "nested", "config.yaml");
  fs.mkdirSync(cwd);
  try {
    const result = Bun.spawnSync([process.execPath, "-e", `
      import assert from "node:assert/strict";
      import fs from "node:fs";
      import path from "node:path";
      const root = ${JSON.stringify(root)};
      const configFile = ${JSON.stringify(configFile)};
      const templateFile = path.join(root, "bundle", "config.example.yaml");
      ${setup}
      // Load after fixture/environment setup; static imports would initialize paths too early.
      const { CONFIG_FILE, LEGACY_CONFIG_FILE, loadConfig, saveConfig } = await import(${JSON.stringify(import.meta.resolve("./config.ts"))});
      ${code}
      process.exit(0);
    `], {
      cwd,
      env: {
        ...process.env,
        DONATE_CONFIG_FILE: override ? configFile : "",
        DONATE_CONFIG_TEMPLATE: "",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15000,
    });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr) || new TextDecoder().decode(result.stdout));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const templateSetup = `
  fs.mkdirSync(path.dirname(templateFile), { recursive: true });
  const template = "# bundled defaults\\ntiktok:\\n  username: first-run\\ntts:\\n  volume: 0.35\\n";
  fs.writeFileSync(templateFile, template);
  process.env.DONATE_CONFIG_TEMPLATE = templateFile;
`;

function existingConfig(raw: string) {
  return `
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, ${JSON.stringify(raw)});
  `;
}

describe("config file persistence", () => {
  test("loads and atomically updates the explicit YAML path from an unrelated cwd", () => {
    runIsolatedConfig(existingConfig("tiktok:\n  username: saved-user\nspotify:\n  client_secret: saved-secret\n"), `
      assert.equal(CONFIG_FILE, configFile);
      assert.equal(LEGACY_CONFIG_FILE, path.join(path.dirname(configFile), "connector-config.json"));
      assert.equal(loadConfig().username, "saved-user");
      assert.equal(loadConfig().spotifyClientSecret, "saved-secret");
      const originalRename = fs.renameSync;
      let renames = 0;
      fs.renameSync = (source, destination) => {
        renames++;
        assert.equal(destination, configFile);
        assert.equal(path.dirname(source), path.dirname(configFile));
        assert.equal(fs.readFileSync(configFile, "utf8").includes("saved-user"), true);
        return originalRename(source, destination);
      };
      try {
        assert.equal(saveConfig({ username: "updated-user", spotifyRefreshToken: "new-token" }), true);
      } finally {
        fs.renameSync = originalRename;
      }
      assert.equal(renames, 1);
      assert.equal(loadConfig().username, "updated-user");
      assert.equal(loadConfig().spotifyClientSecret, "saved-secret");
      assert.equal(loadConfig().spotifyRefreshToken, "new-token");
      assert.deepEqual(fs.readdirSync(path.dirname(configFile)), ["config.yaml"]);
      assert.deepEqual(fs.readdirSync(process.cwd()), []);
      assert.equal(fs.existsSync(path.join(root, "config.yaml")), false);
      if (process.platform !== "win32") assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
    `);
  });

  test("keeps development cwd fallback when no explicit config path is set", () => {
    runIsolatedConfig("", `
      assert.equal(CONFIG_FILE, path.join(process.cwd(), "config.yaml"));
      assert.equal(LEGACY_CONFIG_FILE, path.join(process.cwd(), "connector-config.json"));
      assert.equal(saveConfig({ username: "development" }), true);
      assert.equal(loadConfig().username, "development");
      assert.equal(fs.existsSync(configFile), false);
    `, false);
  });

  test("copies first-run defaults once into a private parent directory", () => {
    runIsolatedConfig(templateSetup, `
      assert.equal(fs.existsSync(configFile), false);
      assert.equal(loadConfig().username, "first-run");
      assert.equal(fs.readFileSync(configFile, "utf8"), template);
      assert.equal(loadConfig().tts.volume, 0.35);
      if (process.platform !== "win32") {
        assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.dirname(configFile)).mode & 0o777, 0o700);
      }
      fs.writeFileSync(templateFile, "tiktok:\\n  username: changed-default\\n");
      assert.equal(loadConfig().username, "first-run");
      assert.equal(fs.readFileSync(configFile, "utf8"), template);
      assert.equal(saveConfig({ username: "user-update" }), true);
      assert.equal(loadConfig().username, "user-update");
      assert.equal(loadConfig().tts.volume, 0.35);
      assert.equal(fs.readFileSync(templateFile, "utf8"), "tiktok:\\n  username: changed-default\\n");
      assert.deepEqual(fs.readdirSync(process.cwd()), []);
    `);
  });

  test("initializes defaults even when save is called before load", () => {
    runIsolatedConfig(templateSetup, `
      assert.equal(saveConfig({ webhookUri: "https://example.test/webhook" }), true);
      assert.equal(loadConfig().username, "first-run");
      assert.equal(loadConfig().tts.volume, 0.35);
      assert.equal(loadConfig().webhookUri, "https://example.test/webhook");
      assert.equal(fs.readFileSync(templateFile, "utf8"), template);
    `);
  });

  test("never replaces an existing user file with bundled defaults", () => {
    const raw = "# keep this comment\ntiktok:\n  username: existing-user\nspotify:\n  client_secret: private-secret\n";
    runIsolatedConfig(templateSetup + existingConfig(raw), `
      assert.equal(loadConfig().username, "existing-user");
      assert.equal(loadConfig().spotifyClientSecret, "private-secret");
      assert.equal(fs.readFileSync(configFile, "utf8"), ${JSON.stringify(raw)});
      fs.rmSync(templateFile);
      assert.equal(saveConfig({ username: "edited-user" }), true);
      assert.equal(loadConfig().username, "edited-user");
      assert.equal(loadConfig().spotifyClientSecret, "private-secret");
      assert.deepEqual(fs.readdirSync(process.cwd()), []);
    `);
  });

  test("migrates legacy JSON beside the selected config before using defaults", () => {
    runIsolatedConfig(templateSetup + `
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(configFile), "connector-config.json"), JSON.stringify({
        username: "legacy-user", spotifyClientSecret: "legacy-secret",
      }));
      fs.writeFileSync(path.join(process.cwd(), "connector-config.json"), JSON.stringify({ username: "wrong-user" }));
    `, `
      assert.equal(loadConfig().username, "legacy-user");
      assert.equal(loadConfig().spotifyClientSecret, "legacy-secret");
      assert.equal(fs.existsSync(configFile), true);
      assert.equal(loadConfig().username, "legacy-user");
      assert.equal(fs.existsSync(path.join(process.cwd(), "config.yaml")), false);
    `);
  });

  test("preserves malformed YAML and reports save failure", () => {
    for (const raw of ["spotify: [unterminated\n", "- not-a-config-mapping\n", "", "plain-scalar\n"]) {
      runIsolatedConfig(templateSetup + existingConfig(raw), `
        loadConfig();
        assert.equal(saveConfig({ username: "must-not-overwrite" }), false);
        assert.equal(fs.readFileSync(configFile, "utf8"), ${JSON.stringify(raw)});
        assert.deepEqual(fs.readdirSync(path.dirname(configFile)), ["config.yaml"]);
        assert.deepEqual(fs.readdirSync(process.cwd()), []);
      `);
    }
  });

  test("keeps original bytes and cleans temporary files when writing or renaming fails", () => {
    const raw = "tiktok:\n  username: keep-user\nspotify:\n  client_secret: keep-secret\n";
    runIsolatedConfig(existingConfig(raw), `
      const originalWrite = fs.writeFileSync;
      fs.writeFileSync = (file, ...args) => {
        if (String(file).endsWith(".tmp")) {
          originalWrite(file, "partial", { flag: "wx", mode: 0o600 });
          throw new Error("simulated write failure");
        }
        return originalWrite(file, ...args);
      };
      try {
        assert.equal(saveConfig({ username: "lost-update" }), false);
      } finally {
        fs.writeFileSync = originalWrite;
      }
      assert.equal(fs.readFileSync(configFile, "utf8"), ${JSON.stringify(raw)});
      assert.deepEqual(fs.readdirSync(path.dirname(configFile)), ["config.yaml"]);
      const originalRename = fs.renameSync;
      fs.renameSync = () => { throw new Error("simulated rename failure"); };
      try {
        assert.equal(saveConfig({ username: "lost-update" }), false);
      } finally {
        fs.renameSync = originalRename;
      }
      assert.equal(fs.readFileSync(configFile, "utf8"), ${JSON.stringify(raw)});
      assert.deepEqual(fs.readdirSync(path.dirname(configFile)), ["config.yaml"]);
    `);
  });

  test("returns HTTP 500 and preserves malformed YAML when the settings endpoint saves", () => {
    const raw = "spotify: [unterminated\n";
    runIsolatedConfig(existingConfig(raw), `
      import { createServer } from "node:http";
      import { once } from "node:events";
      // State must initialize only after the malformed file fixture exists.
      const { handleStatusRoutes } = await import(${JSON.stringify(import.meta.resolve("./routes/status.ts"))});
      const { state } = await import(${JSON.stringify(import.meta.resolve("./state.ts"))});
      const originalState = structuredClone(state.config);
      const server = createServer((req, res) => {
        handleStatusRoutes(req, res, new URL(req.url, "http://localhost"))
          .then((handled) => { if (!handled) { res.writeHead(404); res.end(); } })
          .catch((error) => { res.writeHead(500); res.end(String(error)); });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/config", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "must-not-overwrite" }),
        });
        assert.equal(response.status, 500);
        assert.equal((await response.json()).success, false);
        assert.equal(fs.readFileSync(configFile, "utf8"), ${JSON.stringify(raw)});
        assert.deepEqual(state.config, originalState);
      } finally {
        server.closeAllConnections();
        const { promise, resolve, reject } = Promise.withResolvers();
        server.close((error) => error ? reject(error) : resolve());
        await promise;
      }
    `);
  });
});
