import { createHash } from "node:crypto";
import { isIP, type Socket } from "node:net";
import tls from "node:tls";
import type { Duplex } from "node:stream";
import ssh2 from "ssh2";
import type { Client, ConnectConfig } from "ssh2";
import { Agent, fetch as undiciFetch } from "undici";
import type { Egress } from "../schemas/egress.js";
import { createProxiedFetch, type ProxiedFetch } from "./fetch-proxy.js";
import { getEgressKeyPair } from "./egress-key.js";

const SSH_READY_TIMEOUT_MS = 10_000;

export interface EgressFetchHooks {
  /** SSH 握手拿到对方主机密钥时回调(出口页「测试连接」用它展示 / 固定指纹)。 */
  onHostKey?: (fingerprint: string) => void;
}

/** 按出口类型拿一个只走该出口的 fetch;用完必须 close。 */
export function openEgressFetch(egress: Egress, hooks: EgressFetchHooks = {}): ProxiedFetch {
  if (egress.type === "proxy") return createProxiedFetch(egress.url!);
  return createSshFetch(egress, hooks);
}

/** 与 `ssh-keygen -lf` 输出一致的 SHA256 指纹。 */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/**
 * 经 SSH 出口发请求:第一次建连时登录出口机,之后每个 TCP 连接都是一条 direct-tcpip 通道
 * (等同 `ssh -W host:port`),HTTPS 的 TLS 在 NodeDeck 这端做,出口机只转发密文。
 * 同一次拉取里换 UA 重试会复用这条 SSH 连接;close 时断开,不留常驻连接。
 */
function createSshFetch(egress: Egress, hooks: EgressFetchHooks): ProxiedFetch {
  const client: Client = new ssh2.Client();
  let ready: Promise<Client> | null = null;
  let mismatch: string | undefined;
  // 'error' 没有监听器会让进程崩掉;建连后的错误(对方断开等)由各通道自己报
  client.on("error", () => undefined);

  const connectSsh = (): Promise<Client> => {
    ready ??= new Promise<Client>((resolve, reject) => {
      const config: ConnectConfig = {
        host: egress.host,
        port: egress.port,
        username: egress.username,
        readyTimeout: SSH_READY_TIMEOUT_MS,
        hostVerifier: (key: Buffer) => {
          const fp = hostKeyFingerprint(key);
          hooks.onHostKey?.(fp);
          if (egress.host_key && egress.host_key !== fp) {
            mismatch = fp;
            return false;
          }
          return true;
        },
      };
      if (egress.auth === "password") config.password = egress.password;
      else config.privateKey = getEgressKeyPair().privateKey;
      client.once("ready", () => resolve(client));
      client.once("error", (err) => reject(new Error(describeSshError(err, egress, mismatch), { cause: err })));
      client.connect(config);
    });
    return ready;
  };

  const openChannel = async (host: string, port: number): Promise<Duplex> => {
    const conn = await connectSsh();
    return new Promise<Duplex>((resolve, reject) => {
      conn.forwardOut("127.0.0.1", 0, host, port, (err, stream) => {
        if (err) reject(new Error(`出口机拒绝转发到 ${host}:${port}(${err.message});检查 sshd 的 AllowTcpForwarding`, { cause: err }));
        else resolve(stream);
      });
    });
  };

  const dispatcher = new Agent({
    connect: (opts, callback) => {
      const host = opts.hostname.replace(/^\[|\]$/g, "");
      const https = opts.protocol === "https:";
      const port = Number(opts.port) || (https ? 443 : 80);
      openChannel(host, port).then(
        (channel) => {
          // undici 对 socket 只用到 Duplex 能力(write / cork / destroy),ref/unref 有判空
          if (!https) return callback(null, channel as unknown as Socket);
          const socket = tls.connect({
            socket: channel,
            servername: opts.servername || (isIP(host) ? undefined : host),
            ALPNProtocols: ["http/1.1"],
          });
          const onError = (err: Error) => callback(err, null);
          socket.once("error", onError);
          socket.once("secureConnect", () => {
            socket.removeListener("error", onError);
            callback(null, socket);
          });
        },
        (err: Error) => callback(err, null),
      );
    },
  });

  const proxied = ((input: string | URL, init?: RequestInit) =>
    undiciFetch(input, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as typeof globalThis.fetch;

  return {
    fetch: proxied,
    close: async () => {
      await dispatcher.close().catch(() => undefined);
      client.end();
    },
  };
}

/** ssh2 的报错是英文短句,翻成能直接指导修复的说法。 */
function describeSshError(err: Error & { level?: string; code?: string }, egress: Egress, mismatch?: string): string {
  const target = `${egress.username}@${egress.host}:${egress.port}`;
  if (mismatch) return `SSH 主机指纹不符(期望 ${egress.host_key},实际 ${mismatch});确认对方确实换过密钥后,在出口里更新指纹`;
  if (err.level === "client-authentication") {
    return egress.auth === "password"
      ? `SSH 登录 ${target} 被拒绝,检查用户名和密码`
      : `SSH 登录 ${target} 被拒绝:出口机的 authorized_keys 里还没有 NodeDeck 的公钥(出口页可复制)`;
  }
  if (err.level === "client-timeout") return `SSH 连接 ${target} 握手超时`;
  if (err.code === "ECONNREFUSED") return `SSH 连接 ${target} 被拒绝(端口没开或防火墙拦了)`;
  if (err.code === "ETIMEDOUT") return `SSH 连接 ${target} 超时(安全组 / 防火墙可能没放行服务器 IP)`;
  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return `SSH 主机 ${egress.host} 解析失败`;
  return `SSH 连接 ${target} 失败: ${err.message}`;
}
