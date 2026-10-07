# Public product rollout

0. Apply Organized Codebase agent templates to the new docs repository and confirm the existing Scout. Commit and report.
1. Create public GitHub repository `organized-ai/a1-scout-docs`. Use supplied `public/index.html`; split every page into real routes including `/welcome`, `/quickstart`, `/api/scan`; retain GSAP. Add `/llms.txt` and Markdown for every page. Configure Wrangler assets with `{"directory":"./public"}`. Inspect and reuse GTM/Stape for GA4 and Meta events `docs_view`, `quickstart_copy`, `signup_start`. Deploy with Wrangler, verify, commit, report the URL and stop.
2. Workspace isolation in all D1 tables (picks, runs, kv, bench_runs, bench_votes, bench_battles, notes) and every KV key. Add migration, hashed per-workspace SCOUT_TOKEN, preserve Cloudflare Access dashboard sign-in. Verify owner drive data cannot leak across workspaces. Commit, report and stop.
3. DRIVE_UUID/DRIVE_MOUNT with A1_UUID/A1_MOUNT fallbacks. Agent install/run/pull/bench/status commands and first-run volume UUID discovery for macOS/Linux. Commit, report and stop.
4. R2 prefix per workspace, Queues consumer for approved Hub picks respecting include globs, agent pull ID --to DIR from R2. Never delete a revision. Commit, report and stop.
5. Null/choice/score shape schemas, stash/shapes/<name>/ convention, POST /api/gate with pick/shortlist/none and confidence threshold, one Bench suite per shape. Commit, report and stop.
6. Queue MLX LoRA jobs, store adapters and fused models in workspace storage, log every run to Bench. Commit, report and stop.
