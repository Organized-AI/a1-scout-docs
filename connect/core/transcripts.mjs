// Full transcripts (opt-in): the session log file itself, gzipped, with anything shaped like a credential replaced by
// [redacted:credential]. Unlike the summaries, a transcript keeps prompts, replies, code, file contents, paths and URLs,
// so it is only ever sent when the person has turned full transcripts on. Same file in a1-scout and a1-scout-docs.
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_PATTERNS } from "./rules.mjs";

export const MAX_TRANSCRIPT_GZ = 90 * 1024 * 1024; // under Workers' request body limit
// Whole PEM blocks first (inside JSON strings their newlines are escaped as \n), then every single-token pattern.
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const GLOBAL = SECRET_PATTERNS.map(p => new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g"));

export function scrub(text) {
  let redacted = 0;
  const hit = () => (redacted++, "[redacted:credential]");
  let t = String(text).replace(PEM, hit);
  for (const re of GLOBAL) t = t.replace(re, hit);
  return { text: t, redacted };
}

// Pack one session file into outDir/<source>-<digest>.jsonl.gz. Returns what the uploader needs, or a reason it was skipped.
export function packTranscript({ source, digest, file }, outDir) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return { source, digest, skipped: "unreadable" }; }
  const { text, redacted } = scrub(raw);
  const gz = gzipSync(text, { level: 6 });
  if (gz.length > MAX_TRANSCRIPT_GZ) return { source, digest, skipped: "too_large", bytes: text.length };
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const path = join(outDir, `${source}-${digest}.jsonl.gz`);
  writeFileSync(path, gz, { mode: 0o600 });
  return { source, digest, path, bytes: Buffer.byteLength(text), gz_bytes: gz.length, redacted };
}
