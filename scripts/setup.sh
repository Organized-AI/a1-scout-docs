#!/usr/bin/env bash
# One-time setup + deploy for a1-scout-docs. Run from the repo root on a Mac logged in to wrangler.
set -euo pipefail
W="npx -y wrangler@4"
if grep -q REPLACED_BY_SETUP wrangler.jsonc; then
  ID=$($W d1 create a1-scout-waitlist 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$ID" ] || { echo "Could not create the D1 database. If it already exists: $W d1 list"; exit 1; }
  sed -i '' "s/REPLACED_BY_SETUP/$ID/" wrangler.jsonc
  echo "D1 database: $ID"
fi
$W d1 execute a1-scout-waitlist --remote --file=schema.sql -y
$W deploy
T=~/.nvme-stash/waitlist-admin.token; [ -s $T ] || { (umask 077; openssl rand -hex 24 > $T); $W secret put ADMIN_TOKEN < $T; echo "Export token saved to $T"; }
