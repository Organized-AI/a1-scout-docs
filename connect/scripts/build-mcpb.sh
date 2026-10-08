#!/usr/bin/env bash
# Build the Claude Desktop extension (double-click install). Output: ../public/download/a1-scout.mcpb
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/mcpb && mkdir -p dist/mcpb ../public/download
cp -R core mcp dist/mcpb/ && cp mcpb/manifest.json mcpb/icon.png dist/mcpb/
printf '{"type":"module"}\n' > dist/mcpb/package.json
npx -y @anthropic-ai/mcpb validate dist/mcpb/manifest.json
npx -y @anthropic-ai/mcpb pack dist/mcpb ../public/download/a1-scout.mcpb
echo "Built public/download/a1-scout.mcpb"
