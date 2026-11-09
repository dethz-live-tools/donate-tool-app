import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";

const rootDir = process.cwd();
const serverFile = path.join(rootDir, "server.ts");
const viteBin = path.join(rootDir, "node_modules", ".bin", "vite");

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

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:3001/api/status");
    return res.ok;
  } catch {
    return false;
  }
}

async function start() {
  const alreadyRunning = await isServerRunning();

  if (!alreadyRunning) {
    console.log("\x1b[36m[dev] Starting backend server (server.ts)...\x1b[0m");
    try {
      serverProc = spawn(bunBin, [serverFile], {
        cwd: rootDir,
        stdio: "inherit",
        env: process.env,
      });

      serverProc.on("error", () => {
        console.log("\x1b[33m[dev] Falling back to node for server.ts...\x1b[0m");
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
    console.log("\x1b[32m[dev] Backend server already running on port 3001.\x1b[0m");
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
