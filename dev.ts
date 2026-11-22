import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";

const rootDir = process.cwd();
const serverFile = path.join(rootDir, "server", "index.ts");
const viteBin = path.join(rootDir, "node_modules", ".bin", "vite");
const serverPort = Number(process.env.PORT) || 3001;

let serverProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;
let isShuttingDown = false;

function cleanExit() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (serverProc) {
    try {
      serverProc.kill("SIGTERM");
    } catch {}
  }
  if (viteProc) {
    try {
      viteProc.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(0), 100);
}

process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
process.on("exit", cleanExit);

function getBunPath(): string {
  const homeBun = process.env.HOME ? path.join(process.env.HOME, ".bun", "bin", "bun") : "";
  if (homeBun && fs.existsSync(homeBun)) return homeBun;
  return "bun";
}

const bunBin = getBunPath();

const KNOWN_BACKEND_BINS = new Set([
  "donate-server",
  "donate-server.exe",
  "bun",
  "bun.exe",
  "node",
  "node.exe",
]);

function isKnownBackendProcess(comm: string): boolean {
  const base = path.basename(comm.trim().replace(/^"|"$/g, "")).toLowerCase();
  return KNOWN_BACKEND_BINS.has(base);
}

const EXPECTED_SCREEN_SHARE_REVISION = 5;

async function probeBackendStatus(): Promise<"missing" | "current" | "outdated"> {
  try {
    const statusRes = await fetch(`http://127.0.0.1:${serverPort}/api/status`);
    if (!statusRes.ok) return "missing";
    const screenRes = await fetch(`http://127.0.0.1:${serverPort}/api/screen-share/status`);
    if (screenRes.status === 404) return "outdated";
    if (!screenRes.ok) return "outdated";
    const data = await screenRes.json().catch(() => null);
    const rev = Number(data?.status?.apiRevision || 0);
    return rev >= EXPECTED_SCREEN_SHARE_REVISION ? "current" : "outdated";
  } catch {
    return "missing";
  }
}

function findListeningPids(port: number): number[] {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf-8" });
      const pids = new Set<number>();
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[3] === "LISTENING" && parts[1].endsWith(`:${port}`)) {
          const pid = Number(parts[4]);
          if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
        }
      }
      return Array.from(pids);
    }
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf-8",
    });
    return out
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function getProcessCommand(pid: number): string {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf-8",
      }).trim();
      const firstField = out.split(",")[0] || "";
      return firstField.replace(/^"|"$/g, "");
    }
    return execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function stopOutdatedBackend(port: number): Promise<boolean> {
  const pids = findListeningPids(port).filter((pid) => isKnownBackendProcess(getProcessCommand(pid)));
  if (pids.length === 0) return false;

  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {}
  }

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((await probeBackendStatus()) === "missing") return true;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (process.platform !== "win32") {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return (await probeBackendStatus()) === "missing";
}

async function start() {
  let backendState = await probeBackendStatus();

  if (backendState === "outdated") {
    console.log(`\x1b[33m[dev] Outdated backend detected on port ${serverPort}; restarting...\x1b[0m`);
    const stopped = await stopOutdatedBackend(serverPort);
    backendState = stopped ? "missing" : await probeBackendStatus();
  }

  if (backendState === "missing") {
    console.log("\x1b[36m[dev] Starting backend server (bun --watch server/index.ts)...\x1b[0m");
    try {
      serverProc = spawn(bunBin, ["--watch", serverFile], {
        cwd: rootDir,
        stdio: "inherit",
        env: process.env,
      });

      serverProc.on("error", () => {
        console.log("\x1b[33m[dev] Falling back to node for server/index.ts...\x1b[0m");
        serverProc = spawn(process.execPath || "node", [serverFile], {
          cwd: rootDir,
          stdio: "inherit",
          env: process.env,
        });
      });
    } catch {
      serverProc = spawn(process.execPath || "node", [serverFile], {
        cwd: rootDir,
        stdio: "inherit",
        env: process.env,
      });
    }
  } else {
    console.log(`\x1b[32m[dev] Backend server already running on port ${serverPort}.\x1b[0m`);
  }

  console.log("\x1b[35m[dev] Starting Vite UI dev server...\x1b[0m");
  const viteRunner = fs.existsSync(bunBin) ? bunBin : (process.execPath || "node");

  viteProc = spawn(viteRunner, [viteBin], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  viteProc.on("error", (err) => {
    console.error("\x1b[31m[dev] Failed to start Vite:\x1b[0m", err.message);
    cleanExit();
  });

  viteProc.on("exit", (code) => {
    console.log(`\x1b[35m[dev] Vite exited (${code})\x1b[0m`);
    cleanExit();
  });

  if (serverProc) {
    serverProc.on("exit", (code) => {
      if (!isShuttingDown) {
        console.log(`\x1b[33m[dev] Backend server exited (${code})\x1b[0m`);
      }
    });
  }
}

start();
