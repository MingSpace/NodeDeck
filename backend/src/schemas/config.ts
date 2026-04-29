import { z } from "zod";

export const appConfigSchema = z.object({
  admin: z.object({
    username: z.string().min(1).default("admin"),
    password_hash: z.string().min(1),
    must_change_password: z.boolean().default(true),
  }),
  ip_allowlist: z.array(z.string()).default([]),
  public_base_url: z.string().url().optional(),
  default_user_agent: z.string().default("Surge/2400"),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
