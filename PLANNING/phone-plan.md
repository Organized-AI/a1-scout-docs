# A1 Scout on the phone — plan

Two goals:

- **A. Full Scout from the phone.** Everything the desktop dashboard does, usable from the iPhone home-screen app (`/m`).
- **B. Phone chat capture.** Claude (claude.ai / iOS app) and ChatGPT chats feed Scout's work profile, the same way Claude Code and Codex sessions already do.
- **C. Claude Desktop in Coding sessions.** The dashboard's Coding sessions view counts Claude Desktop use: Cowork (local agent mode) sessions, which the collector skips today, and Claude Desktop Code sessions, grouped as one app.

Two repos, one T3 thread each, both on jordan-mac-mini (reached from T3 Code on the M1 through its "Jordan's Mac mini" environment). Each thread runs in its own T3 git worktree, so the mini's checkouts stay as they are:

| Repo | Path on jordan-mac-mini | Base | Branch | Goals |
|---|---|---|---|---|
| Organized-AI/a1-scout (private dashboard, a1-scout.jordan-691.workers.dev) | `/Users/jordaaan/nvme-stash/a1-scout` | `origin/deploy/picks-kind-filter` (what is live) | `feat/phone-parity` | C, then A |
| Organized-AI/a1-scout-docs (public site + connect API, scout.organizedai.vip) | `/Users/jordaaan/a1-scout-docs` | `origin/main` | `feat/phone-capture` | B |

`origin/main` of a1-scout is 16 commits behind the live branch; the a1-scout thread opens a PR to bring main up to date before its feature PR. The collector file is shared: the a1-scout thread owns its Claude Desktop change, and the a1-scout-docs thread copies it over in its last phase.

## What exists today (read from the code)

- Phone app `/m` (PWA with manifest + service worker) covers only: state, activity, bench leaderboard, run request, drive request.
- Desktop-only: Picks (list, status, add), catalog, license check and decisions, notes, scan now, bench battles, Lab / jobs / lessons / map / explain pages.
- Phone sign-in means typing the full `SCOUT_TOKEN` on `/login`.
- Connect API (`a1-scout-docs`) accepts privacy-safe session summaries from paired computers only (Bearer device key). Sources: `claude`, `codex`, `cowork`, `other`. Collector reads `~/.claude/projects` and `~/.codex/sessions` on a Mac. No path for phone chats.

## Architecture

```
                        ┌──────────────────────── iPhone ────────────────────────┐
                        │                                                         │
   A. Scout app (/m)    │  Home-screen PWA  ── one-time sign-in link (QR) ──┐     │
                        │   Picks · type filter · approve/skip/stash         │     │
                        │   Licenses · Scan · Notes · Catalog · Bench        │     │
                        │                                                    │     │
   B1. Export import    │  Claude / ChatGPT export .zip ─► scout.organizedai.vip  │
                        │     /connect/import (unzip + parse IN the browser) │     │
                        │     preview "exactly what is shared" ─► send       │     │
                        │                                                    │     │
   B2. Live log         │  Claude iOS app + "A1 Scout" custom connector      │     │
                        │     "log this chat to Scout" ─► scout_log_chat     │     │
                        └────────────┬───────────────────────────┬───────────┘     
                                     │ summaries only            │ session cookie
                                     ▼                           ▼
     ┌──────────── a1-scout-docs Worker ────────────┐   ┌──────── a1-scout Worker ────────┐
     │ /api/link/*   phone ⇄ workspace link codes   │   │ /login/link  one-time sign-in   │
     │ /api/evidence  Bearer key OR phone cookie    │   │ /api/picks?kind=…  type filter  │
     │ /mcp  remote MCP (OAuth) ─ scout_log_chat    │   │ /m  full phone UI               │
     │ D1: workspaces · device_keys · evidence ·    │   │ D1 a1-scout · KV BENCH          │
     │     links (new) · KV OAUTH_KV (new)          │   └──────────────┬──────────────────┘
     └──────────────────────┬───────────────────────┘                  │
                            │ profile (apps: claude-code, codex,       │ drive / run requests
                            │  claude-chat, chatgpt …)                 ▼
                            ▼                                Mac agent ─► A1 drive downloads
                   Scout work profile ─► picks ranking
```

## Phases (in order, no dates)

### Phase 0 — Setup (both repos)
- Pull `main`, create the feature branch, read AGENTS.md / CLAUDE.md and the Organized Codebase agent templates in `.claude/agents/`.
- Run the existing tests; they must be green before any change.
- Write the gap list (A) or the current `/api/profile` shape (B) into `PLANNING/` as the baseline.

### Phase 1 — Sign-in and linking
- A: one-time phone sign-in link. A signed-in desktop session (or the Mac agent's Bearer token) mints a single-use, 10-minute code; the dashboard shows it as a link and QR; opening it on the phone sets the normal `scout_session` cookie. No token typing.
- B: link a phone browser to an existing Scout workspace. The phone opens `/connect/link/`, gets a code; a connected computer approves it through a new `link_phone` connector tool (or the approving browser's `scout_ws` cookie links it straight away). The phone gets an HttpOnly `scout_dev` cookie whose hash lives in `device_keys` (client `phone-browser`). `/api/evidence` accepts that cookie only with a same-origin `Origin` header.

### Phase 2 — Core phone features
- A: Picks on the phone — status chips (new / approved / stashed / skipped / all) plus asset-type chips (models, datasets, spaces, papers, collections, code), approve / skip / stash, license state inline with "accept license" links. Same type filter added to desktop Picks.
- B: chat-export readers in a pure ESM module (`connect/core/chats.mjs`, no Node built-ins, runs in browsers and Node):
  - Claude export: `conversations.json` → one session per conversation; `sender` human/assistant turns; `content[]` `tool_use` names as tools, `tool_result.is_error` as errors; code fences → languages, imports, install commands → packages, `from_pretrained` → HF models; message timestamps → active minutes. Source `claude`, app `claude-chat`.
  - ChatGPT export: walk `mapping` from `current_node` back to root (the visible branch), skip null and system messages; `metadata.model_slug` → model and llms; tool-role author names and `code` content → tools and code signals. Source `other`, app `chatgpt`.
  - Same `observations` shape and the same `rules.mjs` privacy scan as the computer collector. No prompt text, titles, URLs or file names leave the phone.
  - Shared pure helpers (`langOf`, `shellSignals`, `codeSignals`, `observationsOf`) move into `connect/core/signals.mjs`; `collect.mjs` re-exports them so its public API and tests stay unchanged.

### Phase 3 — Phone import page and remaining parity
- B: `/connect/import/` — mobile-first page: pick the export `.zip` (or `conversations.json`) from Files, unzip and parse in a Web Worker (fflate, pinned version from cdnjs/jsdelivr), detect Claude vs ChatGPT, show the preview, send in chunks to `/api/evidence`. GSAP for the progress and preview reveal. If `GTM_ID` is set, push a `scout_chat_import` dataLayer event with counts only.
- A: remaining desktop features on `/m`: scan now, notes, catalog search and add pick, license decisions, bench battle voting, activity/jobs. Each Lab / map / lessons / explain page either gets a phone layout or a clear link to the desktop view.

### Phase 4 — Live capture from the Claude app
- B: remote MCP endpoint `/mcp` on the docs Worker (Streamable HTTP, stateless handler) with OAuth via `@cloudflare/workers-oauth-provider` (new KV `OAUTH_KV`). The authorize step reuses the phone link (cookie or code).
- Tools: `scout_log_chat` (Claude fills names and counts for the current chat: app, model, turns, tools, languages, packages, HF repos; validated by `rules.mjs`; digest from a per-chat reference), `scout_status` (profile summary).
- Added once on claude.ai web as a custom connector, then used from the Claude iPhone app. ChatGPT developer-mode connectors are web-first; test on the ChatGPT phone app and document the result rather than assume it works.

### Phase 5 — Connector, docs, ship
- B: connector 0.3.0 — `link_phone` tool, `scout_status` lists chat apps, rebuild `.mcpb` (`connect/scripts/build-mcpb.sh`). Home page "Connect your AI work" gets a "Phone chats" card; privacy page covers exports and live logging.
- Both: D1 migrations applied, `wrangler versions upload` preview checked on an iPhone viewport (Playwright `devices['iPhone 15']`), then PR to `main`, merge, `wrangler deploy`, post-deploy check of `/api/health` and the phone pages.

## Verification gates
- Tests green before every commit (`node --test` in each repo; Python tests in a1-scout where touched).
- Fixtures are synthetic: never commit a real export or real session data.
- A bundle built from a fixture export passes `validateBundle` and contains no prompt text, title, URL, email or path.
- iPhone-viewport screenshots of every changed phone screen, checked before the PR.
- No claim of "deployed" until the live URL answers.

## Git rules
- Work only on the feature branch; open a PR to `main` on Organized-AI.
- Commits use the repo's existing git identity (Jordan Hill). No AI co-author or session trailers in commits; no "Generated with" lines in PRs.
- Stage explicit paths; never `git add -A` or `git add .`.
