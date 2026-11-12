import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const targets: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
};
const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
if (triple && !targets[triple]) throw new Error(`Unsupported backend target: ${triple}`);
const windows = triple ? triple.includes("windows") : process.platform === "win32";
const output = resolve("src-tauri/backend", windows ? "donate-server.exe" : "donate-server");
mkdirSync(resolve("src-tauri/backend"), { recursive: true });
const child = Bun.spawn([process.execPath, "build", "--compile", ...(triple ? [`--target=${targets[triple]}`] : []), "server/index.ts", "--outfile", output], { stdout: "inherit", stderr: "inherit" });
if (await child.exited !== 0) throw new Error("Backend compilation failed");
