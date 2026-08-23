/**
 * One-shot first-time setup: env files, Python venv + deps, frontend deps.
 * Run from repo root:  npm run setup
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const step = (msg) => console.log(`\n\x1b[36m==>\x1b[0m ${msg}`);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
  if (res.status !== 0) {
    console.error(`\nCommand failed: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// 1. Env files
step("Creating .env files from examples (if missing)");
const envFiles = [
  [path.join(root, ".env.example"), path.join(root, ".env")],
  ["backend/.env.example", "backend/.env"],
  ["frontend/.env.local.example", "frontend/.env.local"],
];
for (const [src, dst] of envFiles.map(([s, d]) => [
  typeof s === "string" ? path.join(root, s) : s,
  typeof d === "string" ? path.join(root, d) : d,
])) {
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    console.log(`  created ${path.relative(root, dst)}`);
  } else {
    console.log(`  exists  ${path.relative(root, dst)}`);
  }
}

// 2. Python venv
step("Setting up backend venv");
const backendDir = path.join(root, "backend");
const python = isWin
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");
if (!existsSync(python)) {
  run("python", ["-m", "venv", ".venv"], { cwd: backendDir });
}

step("Installing backend dependencies (CPU torch, docling, etc.) — this can take a while");
run(python, [
  "-m", "pip", "install",
  "--extra-index-url", "https://download.pytorch.org/whl/cpu",
  "torch",
]);
run(python, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: backendDir });

// 3. Frontend deps
step("Installing frontend dependencies");
run("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(root, "frontend") });

// 4. Root tooling
step("Installing root dev tools (concurrently)");
run("npm", ["install", "--no-audit", "--no-fund"], { cwd: root });

console.log("\n\x1b[32mSetup complete!\x1b[0m Start everything with:\n\n  npm run dev\n");
