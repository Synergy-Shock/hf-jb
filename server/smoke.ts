/**
 * No-model smoke test: proves the sandbox + bridged `hyperframes` command work end to end
 * (in-process lint/timeline, binary assets round-trip, then the host CLI through the bridge).
 *   npm run smoke            # lint + timeline + an edit via heredoc + a binary asset
 *   npm run smoke -- --check # also runs `hyperframes check --json` on host Chrome
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createSandbox, BINARY_PREFIX } from "./sandbox";
import { SCAFFOLD } from "../shared/scaffold";

const ROOT = path.resolve(import.meta.dirname, "..");
const png = await readFile(path.join(ROOT, "node_modules/@hyperframes/studio/dist/favicon.svg")).catch(() => Buffer.from("<svg/>"));
const files = { ...SCAFFOLD, "assets/probe.svg": png.toString("utf8"), "assets/blob.bin": BINARY_PREFIX + Buffer.from([0, 1, 2, 255, 254]).toString("base64") };

const sb = createSandbox({ files, scratchDir: process.argv.includes("--check") ? path.join(ROOT, ".hf-scratch") : undefined });

const steps = [
  "ls -la /workspace /workspace/assets",
  "hyperframes timeline",
  "hyperframes lint --json | head -8",
  // an edit the agent would make: give the title an entrance tween
  `sed -i 's|// Example: tl.fromTo|tl.fromTo|' index.html && grep -c "tl.fromTo" index.html`,
  "hyperframes lint",
  "hyperframes timeline --json | head -20",
  "od -An -tu1 assets/blob.bin",
  "hyperframes nope",
  "hyperframes check --json | head -5",
];

for (const cmd of steps) {
  const r = await sb.exec(cmd);
  console.log(`\n$ ${cmd}\n${r.stdout}${r.stderr ? "[stderr] " + r.stderr.slice(0, 400) : ""}[exit ${r.exitCode}]`);
}
const snap = await sb.snapshot();
console.log("\nsnapshot:", Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, v.slice(0, 24) + (v.length > 24 ? "…" : "")])));
console.log("binary round-trip ok:", snap["assets/blob.bin"] === files["assets/blob.bin"]);
