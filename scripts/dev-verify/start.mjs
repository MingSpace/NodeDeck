// `pnpm dev:verify`:给 agent 用浏览器验证 UI 的一次性环境,和常驻的 `pnpm dev` 互不干扰。
// - 每次从 seed/ 复制一份全新数据到临时目录,不碰 backend/data
// - 后端 8081 + 前端 5174(常驻 dev 是 8080 / 5173),本机回环请求免登录(DEV_AUTH_BYPASS)
// - 顺带起假订阅服务(18090),seed 里的节点源都指向它,不连任何真实机场
import { spawn } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSub } from "./fake-sub.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const dataDir = join(tmpdir(), "nodedeck-dev-verify", "data");
const BACKEND_PORT = "8081";
const FRONTEND_PORT = "5174";
const FAKE_SUB_PORT = 18090;

rmSync(dataDir, { recursive: true, force: true });
cpSync(join(here, "seed"), dataDir, { recursive: true });
console.log(`[dev-verify] data: ${dataDir}`);

await startFakeSub(FAKE_SUB_PORT);

const children = [
  spawn("pnpm", ["-F", "backend", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development", DATA_DIR: dataDir, PORT: BACKEND_PORT, DEV_AUTH_BYPASS: "1" },
  }),
  spawn("pnpm", ["-F", "frontend", "exec", "vite", "--port", FRONTEND_PORT, "--strictPort"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODEDECK_BACKEND_PORT: BACKEND_PORT },
  }),
];
console.log(`[dev-verify] open http://localhost:${FRONTEND_PORT}/ (免登录)`);

const shutdown = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) child.on("exit", shutdown);
