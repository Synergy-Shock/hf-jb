/**
 * System prompt = the HyperFrames skill (as installed in ~/.claude/skills when available,
 * otherwise the bundled copy) + the harness contract.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SKILL_BUNDLE } from "../shared/skill-bundle";

const SKILL_DIR = process.env.HF_SKILL_DIR ?? path.join(os.homedir(), ".claude/skills/hyperframes");

let cached: string | undefined;

export async function buildSystemPrompt(opts: { hostTools: boolean }): Promise<string> {
  cached ??= await loadSkill();
  return [harness(opts.hostTools), cached].join("\n\n");
}

async function loadSkill() {
  const local = await Promise.all([
    safeRead(path.join(SKILL_DIR, "SKILL.md")),
    safeRead(path.join(SKILL_DIR, "references/format.md")),
    safeRead(path.join(SKILL_DIR, "references/motion.md")),
  ]);
  const [skill, format, motion] = local.every(Boolean) ? (local as string[]) : [SKILL_BUNDLE.skill, SKILL_BUNDLE.format, SKILL_BUNDLE.motion];
  return ["# HyperFrames skill (SKILL.md)", skill, "# references/format.md", format, "# references/motion.md (excerpt)", motion.slice(0, 6000)].join("\n\n");
}

const harness = (hostTools: boolean) => `You are editing a HyperFrames video project inside a virtual bash sandbox (just-bash).

Environment facts (they override anything below that assumes a real shell):
- The project root is /workspace. index.html is the root composition; scenes go in /workspace/compositions/*.html; assets in /workspace/assets/.
- Use the bash tool for everything: cat, sed, grep, mkdir, and heredocs (cat > file <<'EOF') to write files. readFile/writeFile tools also exist.
- readFile on a .png/.jpg/.gif/.webp returns the image itself, so you can see attached assets in /workspace/assets/ before placing them (size, subject, colours). Reference them as root-relative "assets/<name>".
- There is no node, npm, npx, python or Chrome inside the sandbox. The command \`hyperframes\` IS available as a bridged command:
    hyperframes lint [--json]       fast, in-process linter. Run after every edit.
    hyperframes timeline [--json]   clip list with absStart/absEnd. Run to see what plays when.
${
  hostTools
    ? `    hyperframes check --json        full gate (runtime, layout, contrast) on the host's Chrome. Slower (10-40s). Run before declaring done.
    hyperframes snapshot --at 1,3,5 PNG frames rendered on the host and copied into /workspace/snapshots/. readFile each PNG to LOOK at the frame before judging the result.
    hyperframes render --quality draft --output renders/out.mp4   host render. Only when the user asks for the file.`
    : `    (check, snapshot and render are NOT available in this hosted deployment: say so if asked, and rely on lint + the live player.)`
}
  Never run \`npx hyperframes ...\`; call \`hyperframes ...\` directly. preview, history, usage, feedback, publish and cloud do not exist here.
- The person sees the composition live in a player next to this chat; it reloads after each of your tool calls. So: make the edit, lint, then reply briefly with what changed. Don't ask to open a preview.
- Sub-compositions and assets resolve through the player's virtual filesystem, but keep things in index.html unless a scene file is clearly better.
- GSAP is loaded from the CDN tag already in index.html; keep the paused timeline registered as window.__timelines["main"].
- Keep replies short. Answer in the language the person writes in.`;

async function safeRead(p: string) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}
