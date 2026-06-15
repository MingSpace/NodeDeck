import { z } from "zod";

export const userinfoSchema = z.object({
  upload: z.number().int().nonnegative().default(0),
  download: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().default(0),
  expire: z.number().int().nonnegative().default(0),
});

export type UserInfo = z.infer<typeof userinfoSchema>;

export function parseUserInfoHeader(header: string | null | undefined): UserInfo | null {
  if (!header) return null;
  const result: Partial<UserInfo> = {};
  for (const part of header.split(";")) {
    const [k, v] = part.split("=", 2).map((s) => s.trim());
    if (!k || !v) continue;
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) continue;
    if (k === "upload" || k === "download" || k === "total" || k === "expire") {
      result[k] = n;
    }
  }
  if (Object.keys(result).length === 0) return null;
  return userinfoSchema.parse(result);
}

export function formatUserInfoHeader(info: UserInfo): string {
  const parts: string[] = [];
  if (info.upload) parts.push(`upload=${info.upload}`);
  if (info.download) parts.push(`download=${info.download}`);
  if (info.total) parts.push(`total=${info.total}`);
  if (info.expire) parts.push(`expire=${info.expire}`);
  return parts.join("; ");
}
