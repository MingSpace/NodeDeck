import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import ssh2 from "ssh2";
import { dataPath } from "../storage/paths.js";
import { logger } from "../logger.js";

/**
 * SSH 出口默认用的登录密钥:NodeDeck 自己的一把 ed25519,首次用到时生成,私钥存
 * data/egress_ed25519(0600,与 secret.key 同级,reset 不会删)。公钥在 Web UI 出口页展示,
 * 用户把它加进出口机的 authorized_keys 即可,不用把任何人的私钥交给 NodeDeck。
 */

const KEY_FILE = "egress_ed25519";
const KEY_COMMENT = "nodedeck-egress";

export interface EgressKeyPair {
  privateKey: string;
  /** OpenSSH 一行格式:`ssh-ed25519 AAAA… nodedeck-egress` */
  publicKey: string;
}

let cached: EgressKeyPair | null = null;

export function getEgressKeyPair(): EgressKeyPair {
  if (cached) return cached;
  const path = dataPath(KEY_FILE);
  let privateKey: string;
  if (existsSync(path)) {
    privateKey = readFileSync(path, "utf8");
  } else {
    privateKey = generatePrivateKey();
    writeFileSync(path, privateKey, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows / 某些 FS 不支持 chmod,忽略
    }
    logger.info("已生成 SSH 出口密钥 data/egress_ed25519");
  }
  const parsed = ssh2.utils.parseKey(privateKey);
  if (parsed instanceof Error) {
    throw new Error(`data/${KEY_FILE} 不是有效的私钥(${parsed.message});删掉它会重新生成,但要重新给出口机加公钥`);
  }
  cached = {
    privateKey,
    publicKey: `${parsed.type} ${parsed.getPublicSSH().toString("base64")} ${KEY_COMMENT}`,
  };
  return cached;
}

// ssh2 1.17 的 generateKeyPairSync 偶尔(实测约 0.5%)产出自己 parseKey 都读不了的
// ed25519 私钥,生成后先自检,坏了重来
function generatePrivateKey(): string {
  for (let i = 0; i < 5; i++) {
    const key = ssh2.utils.generateKeyPairSync("ed25519", { comment: KEY_COMMENT }).private;
    if (!(ssh2.utils.parseKey(key) instanceof Error)) return key;
  }
  throw new Error("生成 SSH 出口密钥失败");
}

/**
 * 给出口机 authorized_keys 用的一行:只放行端口转发,禁止开 shell / pty / agent / X11。
 * 只用 OpenSSH 与 dropbear 都认的选项(没用 OpenSSH 专有的 `restrict`),路由器也能直接贴。
 */
export function authorizedKeysLine(publicKey: string): string {
  return `command="/bin/false",no-pty,no-agent-forwarding,no-X11-forwarding ${publicKey}`;
}

export function __resetEgressKeyForTest(): void {
  cached = null;
}
