# Step 0 handoff

## Phone capture — Phase 0 / Phase 1 (2026-11-11)

Goal B only, branch feat/phone-capture; git identity Jordan Hill. Baseline connector tests 9/9 and root tests 9/9 passed before edits. Supplied phone plan copied byte-for-byte and committed first (4789a44).

Phase 1 adds expiring phone links, Bearer-only approval, atomic single-use cookie issuance, same-origin cookie authentication, the link page and link_phone connector tool. Existing collector and rules are untouched. Current profile shape: workspace, sessions, computers, projects, last_session, apps and top tools/commands/languages/packages/libraries/models, plus transcript counts. Next: pure browser-compatible chat readers; no private dashboard edits.

Phase 1 verify-build review completed. Fixed concurrent rate-limit admission with a single conditional INSERT; cookie keys cannot manage full transcripts. Root tests 12/12, connector tests 9/9 and diff whitespace check pass. Import destination has an explicit temporary linked-state page with Markdown parity until Phase 3. Browser/iPhone, GSAP/tracking and live D1/deployment verification remain pending; no deployment claim.

## Phone capture — Phase 2 (2026-11-11)

Added browser-compatible signal helper mirror, async SHA-256 chat readers, 400-row validated bundles and collector-equivalent preview. Synthetic fixtures cover Claude tools/errors/install fences, ChatGPT visible branch/model counts, and planted private data. Helper parity executes original collector helpers against identical inputs without editing collector/rules. Verify-build: connector tests 13/13, root tests 12/12, whitespace check pass. No real exports used. Next: worker-based phone import and iPhone screenshots.

Docs path: `/Users/jordaaan/a1-scout-docs`.
Confirmed Scout path: `/Users/jordaaan/nvme-stash/a1-scout`.
The requested `/Users/supabowl` does not exist; this uses the earlier confirmed `/Users/jordaaan` correction.

Scout origin: https://github.com/Organized-AI/a1-scout.git
Observed Scout HEAD: 0b60ad0.
Confirmed src/index.js, agent/agent.py, schema.sql, wrangler.jsonc and tests/. Schema has all seven requested tables. Wrangler config defines private dashboard assets, D1 DB, BENCH KV and Cloudflare custom domain scout.organizedai.vip. This is source inspection, not a live deployment check.

Existing Scout modifications: four tracked __pycache__ .pyc deletions. No Scout files were changed in Step 0.

Step 0: template structure and local agent definitions prepared. Phase 1 has not started. GitHub repository not created; docs not deployed.

Next input: user-supplied docs HTML at public/index.html. Current session exposes no GTM or Stape tools; inspect available tools again on resume and reuse the existing setup once accessible. Do not fabricate tracking IDs or claim tracking is configured.

Stop after this checkpoint as requested.
