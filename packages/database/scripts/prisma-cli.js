const path = require("path");
const dotenv = require("dotenv");
const { spawnSync } = require("child_process");

// 1. Try loading from process.cwd() (if run from root or elsewhere)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
// 2. Try loading from repo root (relative to packages/database)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
// 3. Try loading from local package dir
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const args = process.argv.slice(2);
const prismaBin = process.platform === "win32" ? "npx.cmd" : "npx";

const result = spawnSync(prismaBin, ["prisma", ...args], {
  stdio: "inherit",
  env: process.env,
  cwd: path.resolve(__dirname, ".."),
  shell: true,
});

process.exit(result.status ?? 0);
