import { describe, expect, it } from "vitest";
import {
  checkModuleText,
  parseArgumentDefaults,
  parseSgmodule,
  renderLocalSgmodule,
  substituteArguments,
} from "../../src/surge-modules/sgmodule.js";
import { surgeModuleSchema } from "../../src/schemas/surge-module.js";

describe("parseSgmodule", () => {
  it("reads #! meta (lowercased keys) and sections, dropping blank / comment lines", () => {
    const parsed = parseSgmodule(
      [
        "﻿#!name=Demo",
        "#!desc=示例 = 带等号",
        "#!Requirement=CORE_VERSION>=20",
        "# 普通注释",
        "[URL Rewrite]",
        "^https://a.example.com https://b.example.com 302",
        "",
        "; 注释",
        "[MITM]",
        "hostname = %APPEND% a.example.com",
        "[url rewrite]",
        "^https://c.example.com - reject",
      ].join("\r\n"),
    );
    expect(parsed.meta).toEqual({ name: "Demo", desc: "示例 = 带等号", requirement: "CORE_VERSION>=20" });
    expect(parsed.sections).toEqual([
      {
        name: "URL Rewrite",
        lines: ["^https://a.example.com https://b.example.com 302", "^https://c.example.com - reject"],
      },
      { name: "MITM", lines: ["hostname = %APPEND% a.example.com"] },
    ]);
  });
});

describe("checkModuleText", () => {
  it("accepts module text, rejects empty / HTML / unrelated text", () => {
    expect(checkModuleText("#!name=x\n[Rule]\nDOMAIN,a.com,REJECT")).toBeNull();
    expect(checkModuleText("  \n")).toMatch(/空内容/);
    expect(checkModuleText("<!DOCTYPE html><html></html>")).toMatch(/HTML/);
    expect(checkModuleText("hello world")).toMatch(/不像 Surge 模块/);
  });
});

describe("renderLocalSgmodule", () => {
  it("writes meta header + non-empty sections in a stable order", () => {
    const mod = surgeModuleSchema.parse({
      id: "m",
      name: "My\nModule",
      description: "desc",
      arguments: "host:a.example.com",
      requirement: "SYSTEM = 'iOS'",
      content_sections: {
        mitm: "hostname = %APPEND% {{{host}}}",
        url_rewrite: "# 注释\n^https://x.example.com - reject\n",
        script: "",
      },
    });
    expect(renderLocalSgmodule(mod)).toBe(
      [
        "#!name=My Module",
        "#!desc=desc",
        "#!arguments=host:a.example.com",
        "#!requirement=SYSTEM = 'iOS'",
        "",
        "[URL Rewrite]",
        "^https://x.example.com - reject",
        "",
        "[MITM]",
        "hostname = %APPEND% {{{host}}}",
        "",
      ].join("\n"),
    );
  });
});

describe("arguments", () => {
  it("parses defaults and substitutes placeholders, reporting missing ones once", () => {
    const defaults = parseArgumentDefaults("host:a.example.com, enable:true,policy,bad-name:1");
    expect([...defaults.entries()]).toEqual([
      ["host", "a.example.com"],
      ["enable", "true"],
      ["policy", undefined],
    ]);
    const missing: string[] = [];
    const out = substituteArguments(
      ["hostname = {{{host}}}", "DOMAIN,x,{{{policy}}}", "DOMAIN,y,{{{policy}}}"],
      defaults,
      (n) => missing.push(n),
    );
    expect(out).toEqual(["hostname = a.example.com", "DOMAIN,x,", "DOMAIN,y,"]);
    expect(missing).toEqual(["policy"]);
  });
});

describe("surgeModuleSchema", () => {
  it("defaults to local, requires an http(s) url for remote", () => {
    expect(surgeModuleSchema.parse({ id: "a", name: "A" })).toMatchObject({ source: "local", fetch_via: [], content_sections: {} });
    expect(surgeModuleSchema.safeParse({ id: "a", name: "A", source: "remote" }).success).toBe(false);
    expect(surgeModuleSchema.safeParse({ id: "a", name: "A", source: "remote", url: "ftp://x" }).success).toBe(false);
    expect(
      surgeModuleSchema.safeParse({ id: "a", name: "A", source: "remote", url: "https://example.com/a.sgmodule" }).success,
    ).toBe(true);
  });
});
