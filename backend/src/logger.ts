import pino from "pino";
import pinoPretty from "pino-pretty";
import { env } from "./env.js";
import { ringStream } from "./log-buffer.js";

const isDev = env.NODE_ENV !== "production";

/*
 * 用 pino.multistream 同时输出到:
 * 1. 终端(dev 用 pino-pretty 染色,prod 直接 JSON 到 stdout)
 * 2. 内存 ring buffer(供 Web UI /api/logs/stream 消费)
 *
 * 注意: multistream 与 transport 选项互斥。dev 下使用 pino-pretty 的同步 transform-stream
 * 用法(非 worker thread),功能与原先 transport 写法等价,且能与 multistream 共存。
 *
 * redact 配置由 pino 主进程在序列化阶段执行,故所有 stream(含 ringStream)拿到的都是
 * 已脱敏文本,不会向前端泄漏密码 / uuid / token。
 */
const prettyOrStdout = isDev
  ? pinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss" })
  : process.stdout;

const streams: pino.StreamEntry[] = [
  { level: env.LOG_LEVEL, stream: prettyOrStdout },
  { level: env.LOG_LEVEL, stream: ringStream },
];

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "*.password",
        "*.uuid",
        "*.psk",
        "*.private_key",
        "*.privateKey",
        "*.token",
        "req.headers.cookie",
        "req.headers.authorization",
      ],
      censor: "[REDACTED]",
    },
  },
  pino.multistream(streams),
);
