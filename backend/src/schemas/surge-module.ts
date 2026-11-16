import { z } from "zod";
import { idSchema } from "./common.js";
import { fetchViaSchema } from "./provider.js";

/**
 * SurgeModule = 一个 Surge 模块(.sgmodule)。Surge 专属,Clash 输出完全忽略。
 *
 * 两种来源:
 * - `local`:内容存在本文件,按段原文编辑(content_sections);
 * - `remote`:内容来自 `url`(如 GitHub 上维护的 .sgmodule),NodeDeck 拉下来缓存在 data/cache,
 *   本文件只存地址。改远程文件即可,不用回 NodeDeck 编辑。
 *
 * 两种来源用法相同:
 * - Profile 的 surge_modules 选中 → 按 Surge 模块语义并进生成的 .conf(generators/surge-module-merge.ts);
 * - 公开地址 /module/<id>.sgmodule(无需 token) → 设备上「从 URL 安装模块」,各设备各自开关。
 *
 * 各段内容一律按 **Surge 模块语法** 写(manual.nssurge.com/profile/module.html):
 * [General] / [MITM] 支持 `key = %APPEND% v` / `key = %INSERT% v`,`{{{参数}}}` 引用 #!arguments。
 */
export const surgeModuleSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().optional(),

    source: z.enum(["local", "remote"]).default("local"),
    // remote:上游 .sgmodule 地址
    url: z.string().optional(),
    // remote:拉取线路(出口 id 列表),语义同节点源 fetch_via —— 服务器连不上 GitHub 等时借出口机拉
    fetch_via: fetchViaSchema,

    // local:各段原文(不含段头)。ruleset_inline 历史字段,目前不输出。
    content_sections: z
      .object({
        general: z.string().optional(),
        host: z.string().optional(),
        ruleset_inline: z.string().optional(),
        rule: z.string().optional(),
        url_rewrite: z.string().optional(),
        header_rewrite: z.string().optional(),
        body_rewrite: z.string().optional(),
        script: z.string().optional(),
        mitm: z.string().optional(),
      })
      .default({}),

    // local:模块头元数据(#!arguments= / #!requirement=);remote 以上游文件头为准
    arguments: z.string().optional(),
    requirement: z.string().optional(), // e.g. "CORE_VERSION>=22"
  })
  .superRefine((m, ctx) => {
    if (m.source !== "remote") return;
    if (!m.url?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "远程模块必须填写 URL" });
      return;
    }
    let ok = false;
    try {
      const u = new URL(m.url.trim());
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "URL 必须是 http(s) 地址" });
  });

export type SurgeModule = z.infer<typeof surgeModuleSchema>;
