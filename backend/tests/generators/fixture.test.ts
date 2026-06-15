import { describe, expect, it } from "vitest";
import { generateClashConfig } from "../../src/generators/clash.js";
import { generateSurgeConfig } from "../../src/generators/surge.js";
import { profile, nodes, groups, rules, finalRule, general } from "./__fixtures__/example-profile.input.js";

/**
 * Fixture comparison test (snapshot-based).
 *
 * Asserts the generator outputs are stable across refactors. After intentional
 * changes to generator code, run `pnpm exec vitest -u tests/generators/fixture` to update.
 */

function normalize(text: string): string {
  return text
    .replace(/Generated at: [^\n]+/g, "Generated at: [TIMESTAMP]")
    .replace(/^# generated_at:[^\n]+/m, "# generated_at: [TIMESTAMP]");
}

describe("generator fixtures", () => {
  it("clash output matches snapshot", () => {
    const out = generateClashConfig({
      profile,
      nodes,
      groups,
      rules,
      finalRule,
      general,
      warnings: [],
    });
    expect(normalize(out)).toMatchSnapshot();
  });

  it("surge output matches snapshot", () => {
    const out = generateSurgeConfig({
      profile,
      nodes,
      groups,
      rules,
      finalRule,
      general,
      surgeModules: [],
      managed_config_url: "https://sub.example.com/sub?profile=example&target=surge&t=fixturetoken",
      warnings: [],
    });
    expect(normalize(out)).toMatchSnapshot();
  });
});
