import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().default("./data"),
  STATIC_DIR: z.string().optional(),
  INITIAL_PASSWORD: z.string().min(4).default("changeme"),
  SESSION_SECRET: z.string().min(16).default("dev-secret-please-change-in-production"),
  PUBLIC_BASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_BUFFER_SIZE: z.coerce.number().int().positive().default(2000),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
