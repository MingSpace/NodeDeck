import { readFile } from "node:fs/promises";
import type { Provider } from "../schemas/provider.js";
import { logger } from "../logger.js";

export interface FetchResult {
  text: string;
  userinfo_header: string | null;
  fetched_at: number;
}

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024;

export async function fetchProviderContent(provider: Provider): Promise<FetchResult> {
  if (provider.type === "inline") {
    return {
      text: provider.content ?? "",
      userinfo_header: null,
      fetched_at: Date.now(),
    };
  }
  if (provider.type === "file") {
    const text = await readFile(provider.path!, "utf8");
    return {
      text,
      userinfo_header: null,
      fetched_at: Date.now(),
    };
  }
  // type === "http"
  const url = provider.url!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": provider.user_agent || "Surge/2400",
        accept: "*/*",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const userinfoHeader = res.headers.get("subscription-userinfo");
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      logger.info(
        {
          providerId: provider.id,
          status: res.status,
          bytes: text.length,
          hasUserinfo: !!userinfoHeader,
        },
        "Provider HTTP fetch ok",
      );
      return {
        text,
        userinfo_header: userinfoHeader,
        fetched_at: Date.now(),
      };
    }
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > MAX_BYTES) {
          throw new Error(`Subscription exceeds size limit (${MAX_BYTES} bytes)`);
        }
        chunks.push(value);
      }
    }
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    const text = new TextDecoder().decode(buf);
    logger.info(
      {
        providerId: provider.id,
        status: res.status,
        bytes: text.length,
        hasUserinfo: !!userinfoHeader,
      },
      "Provider HTTP fetch ok",
    );
    return {
      text,
      userinfo_header: userinfoHeader,
      fetched_at: Date.now(),
    };
  } catch (err) {
    logger.warn({ err, providerId: provider.id, url }, "Provider fetch failed");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
