import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const COOKIE_NAME = "nodedeck_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionPayload {
  username: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

function sign(text: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(text).digest("base64url");
}

export function createSessionCookie(username: string): string {
  const payload: SessionPayload = {
    username,
    issued_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL_MS,
    nonce: randomBytes(8).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  const value = `${body}.${sig}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function verifySessionCookie(cookieHeader: string | null | undefined): SessionPayload | null {
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const value = cookies[COOKIE_NAME];
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.expires_at < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
