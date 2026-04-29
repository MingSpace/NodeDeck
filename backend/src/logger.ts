import pino from "pino";
import { env } from "./env.js";

const isDev = env.NODE_ENV !== "production";

export const logger = pino({
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
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
    },
  }),
});
