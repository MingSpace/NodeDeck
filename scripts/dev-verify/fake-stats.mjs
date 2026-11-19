// 假的订阅拉取统计(data/stats/pulls.json):按启动时间现算,日期永远落在仪表盘的 30 天窗口里。
// 前 9 天留空,演示「从哪天开始统计」;IP 全是内网段,UA 是 Surge 各端的典型写法。
// 只生成 Surge 拉取(Clash 输出已移除):days 里每个 profile 只有 surge 计数,设备的 target 固定 "surge"。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function writeFakeStats(dataDir, now = Date.now()) {
  const days = {};
  for (let i = 20; i >= 0; i--) {
    const surge = 8 + Math.round(6 * Math.sin(i / 2) + (i % 3) * 2);
    days[dayKey(now - i * DAY)] = { profiles: { demo: { surge } }, rejected: i === 4 ? 3 : 0 };
  }
  const device = (ip, client, user_agent, ago, count) => [
    `${ip}|${client}`,
    { ip, client, user_agent, profile_id: "demo", target: "surge", first_seen: now - 20 * DAY, last_seen: now - ago, count },
  ];
  const stats = {
    version: 1,
    days,
    last_pulls: { demo: now - 2 * 60_000 },
    devices: Object.fromEntries([
      device("192.168.1.23", "Surge iOS", "Surge iOS/3456", 2 * 60_000, 182),
      device("192.168.1.10", "Surge Mac", "Surge Mac/2890", 50 * 60_000, 96),
      device("10.8.0.6", "Surge iOS", "Surge iOS/3456", 5 * 3_600_000, 41),
      device("192.168.1.31", "Surge Mac", "Surge Mac/2890", 9 * 3_600_000, 64),
      device("10.8.0.9", "Surge iOS", "Surge iOS/3456", 3 * DAY, 12),
    ]),
  };
  mkdirSync(join(dataDir, "stats"), { recursive: true });
  writeFileSync(join(dataDir, "stats", "pulls.json"), JSON.stringify(stats));
}
