import { z } from "zod";
import { idSchema } from "./common.js";

/**
 * SurgeModule represents a Surge [Module] entry. Surge-only feature, completely ignored in Clash output.
 * The module is stored as raw INI section text per type so the user can fine-tune in Monaco editor.
 */
export const surgeModuleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().optional(),

  // raw section content (without section header, e.g. for `[MITM]` section, just the body)
  content_sections: z.object({
    general: z.string().optional(),
    host: z.string().optional(),
    ruleset_inline: z.string().optional(),
    rule: z.string().optional(),
    url_rewrite: z.string().optional(),
    header_rewrite: z.string().optional(),
    body_rewrite: z.string().optional(),
    script: z.string().optional(),
    mitm: z.string().optional(),
  }),

  // metadata in serialized output
  arguments: z.string().optional(),
  requirement: z.string().optional(), // e.g. "CORE_VERSION>=22"
});

export type SurgeModule = z.infer<typeof surgeModuleSchema>;
