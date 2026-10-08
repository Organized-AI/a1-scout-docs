// Bundle rules shared by the local collector and the Scout Worker.
// Pure functions only (no fs/os), so the same file runs in Node and in Cloudflare Workers.
// Bundle shape and checks follow Organized-AI/ai-work-assessment src/evidence-bundle.js (MIT), schema v1,
// so a Scout bundle is also a valid AI Work Assessment evidence bundle.

export const BUNDLE_SCHEMA_VERSION = 1;
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
export const SOURCES = new Set(["codex", "claude", "cowork", "other"]);
const QUALITY = new Set(["metadata-only", "partial-transcript", "full-transcript"]);

// Upstream patterns plus Cloudflare, Hugging Face, fine-grained GitHub, Google, Stripe, Slack webhooks and bearer values.
export const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/,
  /cfat_[A-Za-z0-9_-]{20,}/,
  /cfut_[A-Za-z0-9_-]{20,}/,
  /hf_[A-Za-z0-9]{30,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  /[Bb]earer\s+[A-Za-z0-9._~+\/-]{20,}=*/,
];
export const PRIVATE_PATTERNS = [
  /\/Users\/[^/\s"']+/i,
  /\/home\/[^/\s"']+/i,
  /[A-Za-z]:\\Users\\[^\\\s"']+/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /https?:\/\/[^\s"']+/i,
];

export class BundleError extends Error {
  constructor(message, code = "BUNDLE_INVALID") { super(message); this.code = code; }
}

export function findPrivacyProblem(serialized) {
  const v = String(serialized || "");
  if (SECRET_PATTERNS.some(p => p.test(v))) return "credential";
  if (PRIVATE_PATTERNS.some(p => p.test(v))) return "path, URL or email";
  return null;
}
export function assertPrivacySafe(serialized) {
  const problem = findPrivacyProblem(serialized);
  if (problem === "credential") throw new BundleError("The bundle appears to contain a credential.", "BUNDLE_SECRET_DETECTED");
  if (problem) throw new BundleError("The bundle appears to contain a path, URL, or email address.", "BUNDLE_PRIVATE_DATA_DETECTED");
}

const isObj = v => Boolean(v && typeof v === "object" && !Array.isArray(v));
const arr = v => (Array.isArray(v) ? v : []);
const clean = (v, max) => String(v || "").trim().slice(0, max);
const nn = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0; };
const iso = v => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? new Date(t).toISOString() : ""; };
const day = v => { const c = String(v || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(c) && Number.isFinite(Date.parse(c)) ? c : ""; };
const hex64 = v => { const c = String(v || "").trim().toLowerCase(); return /^[a-f0-9]{64}$/.test(c) ? c : ""; };
const depth = (v, l = 0) => (v == null || typeof v !== "object" ? l : Math.max(l, ...Object.values(v).map(x => depth(x, l + 1))));

export function validateBundle(input) {
  if (!isObj(input)) throw new BundleError("The bundle must be a JSON object.");
  const serialized = JSON.stringify(input);
  if (new TextEncoder().encode(serialized).length > MAX_BUNDLE_BYTES) throw new BundleError("The bundle is too large.", "BUNDLE_TOO_LARGE");
  assertPrivacySafe(serialized);
  if (Number(input.bundle_schema_version) !== BUNDLE_SCHEMA_VERSION) throw new BundleError("Unsupported bundle schema.", "BUNDLE_VERSION_UNSUPPORTED");
  const env = input.environment;
  if (!isObj(env) || !/^[a-f0-9]{24}$/.test(String(env.id || ""))) throw new BundleError("The bundle has no valid opaque environment ID.");
  const collected = iso(input.collected_at);
  if (!collected) throw new BundleError("The bundle has no valid collected_at timestamp.");
  const coverage = arr(input.source_coverage).slice(0, 16).map(c => {
    const source = SOURCES.has(c?.source) ? c.source : "";
    if (!source || !day(c?.from) || !day(c?.to)) throw new BundleError("Every source coverage row needs a supported source and date range.");
    return { source, from: day(c.from), to: day(c.to), coverage_days: nn(c.coverage_days), sessions: nn(c.sessions),
      retention: ["full-available", "retention-limited", "unknown"].includes(c.retention) ? c.retention : "unknown" };
  });
  const sessions = arr(input.session_evidence).slice(0, 20000).map((s, i) => {
    const source = SOURCES.has(s?.source) ? s.source : "";
    const nd = hex64(s?.native_session_digest), fb = hex64(s?.fallback_fingerprint), pf = hex64(s?.project_fingerprint);
    const first = iso(s?.first_event), last = iso(s?.last_event), q = QUALITY.has(s?.evidence_quality) ? s.evidence_quality : "";
    if (!source || (!nd && !fb) || !pf || !first || !last || !q) throw new BundleError(`Session evidence row ${i + 1} is incomplete.`);
    const obs = isObj(s.observations) ? s.observations : {};
    const os = JSON.stringify(obs);
    if (os.length > 24000) throw new BundleError("One session observation is too large.");
    if (depth(obs) > 6) throw new BundleError("One session observation is nested too deeply.");
    return { source, native_session_digest: nd || undefined, fallback_fingerprint: fb || undefined, first_event: first, last_event: last,
      project_fingerprint: pf, evidence_quality: q, event_count: nn(s.event_count), observations: obs };
  });
  return { bundle_schema_version: 1, environment: { id: env.id, kind: ["computer", "vm", "cloud", "other"].includes(env.kind) ? env.kind : "other", ...(clean(env.label, 80) ? { label: clean(env.label, 80) } : {}) },
    collected_at: collected, source_coverage: coverage, session_evidence: sessions };
}
