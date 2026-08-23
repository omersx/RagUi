/**
 * Launches the FastAPI backend from the repo's Python venv (cross-platform).
 * Used by `npm run dev` at the repo root.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(root, "backend");
const isWin = process.platform === "win32";
const python = isWin
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error(
    "[backend] Python venv not found. Run one of:\n" +
      "  npm run setup          (from repo root)\n" +
      "  cd backend && python -m venv .venv && .venv\\Scripts\\pip install -r requirements.txt"
  );
  process.exit(1);
}

const args = ["-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"];

console.log(`[backend] starting: uvicorn app.main:app --reload --port 8000`);
const child = spawn(python, args, {
  cwd: backendDir,
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
    process.exit(0);
  });
}
