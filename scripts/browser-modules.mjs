import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const destination = new URL("../public/connect/modules/", import.meta.url);
if (!process.argv.includes("--check")) mkdirSync(destination, { recursive: true });
for (const name of ["chats", "signals", "rules"]) {
  const source = readFileSync(new URL(`../connect/core/${name}.mjs`, import.meta.url), "utf8");
  const target = new URL(`${name}.mjs`, destination);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== source) throw new Error(`Run npm run build: browser ${name} module is stale.`);
  } else writeFileSync(target, source);
}
