import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// API keys for AI providers are encrypted at rest with AES-256-GCM using
// a key derived from the AI_KEY_ENCRYPTION_SECRET env var (set it in
// Vercel → Environment Variables; any long random string). Without it,
// keys can't be saved through the UI — env-var keys (AI_<PROVIDER>_API_KEY)
// still work as a fallback.

function key() {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) return null;
  return createHash("sha256").update(secret).digest();
}

export function canEncrypt() {
  return key() !== null;
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("AI_KEY_ENCRYPTION_SECRET is not set on the server — add it in Vercel environment variables to store API keys.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string | null {
  const k = key();
  if (!k) return null;
  const [v, ivB64, tagB64, encB64] = payload.split(".");
  if (v !== "v1" || !ivB64 || !tagB64 || !encB64) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
