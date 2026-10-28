// 本地假订阅:按 User-Agent 返回不同内容,复现机场的 UA 网关(以 Xboard 的子串规则为蓝本)。
import http from "node:http";

const node = (name, server) =>
  `  - { name: "${name}", type: ss, server: ${server}, port: 443, cipher: aes-256-gcm, password: pw }`;
const META_YAML = [
  "proxies:",
  node("剩余流量：111.1 GB", "10.0.0.1"),
  node("距离下次重置剩余：12 天", "10.0.0.1"),
  node("HK 01", "10.0.0.1"),
  node("JP 01", "10.0.0.2"),
  "",
].join("\n");

const ss = (server, name) =>
  `ss://${Buffer.from("aes-256-gcm:pw").toString("base64")}@${server}:443#${encodeURIComponent(name)}`;
const B64 = Buffer.from(
  [ss("10.0.0.9", "到期时间：2027-03-01"), ss("10.0.0.3", "US 01"), ss("10.0.0.4", "SG 01")].join("\n"),
).toString("base64");

const EXPIRE = Math.floor(new Date(2027, 5, 19).getTime() / 1000);

export function startFakeSub(port) {
  const server = http.createServer((req, res) => {
    const ua = req.headers["user-agent"] ?? "";
    console.log(`[fake-sub] ${req.url} UA=${JSON.stringify(ua)}`);
    if (req.url === "/meta") {
      res.setHeader(
        "subscription-userinfo",
        `upload=1000000000; download=94456000000; total=214748364800; expire=${EXPIRE}`,
      );
      return res.end(/meta|verge/i.test(ua) ? META_YAML : "");
    }
    if (req.url === "/b64") {
      if (/clash/i.test(ua)) return res.end("<!doctype html><html><body>请使用客户端订阅</body></html>");
      return res.end(B64);
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
