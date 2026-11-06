/**
 * `hyperframes` as a just-bash custom command.
 *
 * Two tiers:
 *  - in-process: lint, timeline -> pure JS (@hyperframes/lint + a DOM scan) reading straight
 *    from the virtual filesystem (ctx.fs). No disk, no Chrome. Works on Vercel.
 *  - host-bridged: check, snapshot, render, … -> the virtual project is materialised to a
 *    scratch dir and the real CLI (Chrome + FFmpeg) runs there. Local only.
 */
import { defineCommand } from "just-bash";
import type { IFileSystem } from "just-bash";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { DOMParser as LinkeDOMParser } from "linkedom";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readAuthoredTimeline } from "../shared/timeline";

// @hyperframes/lint and shared/timeline expect the browser DOMParser; linkedom provides one.
(globalThis as { DOMParser?: unknown }).DOMParser ??= LinkeDOMParser;

const IN_PROCESS = new Set(["lint", "timeline"]);
const HOST = new Set(["check", "snapshot", "render", "doctor", "catalog", "add", "info", "compositions"]);

export interface BridgeOptions {
  /** Virtual project root inside just-bash, e.g. "/workspace". */
  workspace: string;
  /** Host directory for materialising the project. Omit to disable host commands (Vercel). */
  scratchDir?: string;
  /** How to invoke the real CLI. Default: ["npx", "hyperframes@0.9.19"]. */
  cli?: string[];
}

export function createHyperframesCommand(opts: BridgeOptions) {
  const cli = opts.cli ?? ["npx", "hyperframes@0.9.19"];

  return defineCommand("hyperframes", async (args, ctx) => {
    const sub = args[0];
    const rest = args.slice(1);
    const json = rest.includes("--json");

    if (!sub || sub === "--help" || sub === "help") return ok(help(!!opts.scratchDir));

    if (IN_PROCESS.has(sub)) {
      const html = await readProjectIndex(ctx.fs, ctx.cwd, opts.workspace);
      if (!html.ok) return fail(html.error);

      if (sub === "lint") {
        const result = await lintHyperframeHtml(html.html);
        const errors = result.findings.filter((f) => f.severity === "error");
        const body = json ? JSON.stringify({ file: html.file, ...result, ok: errors.length === 0 }, null, 2) : formatLint(html.file, result.findings);
        return { stdout: body + "\n", stderr: "", exitCode: errors.length ? 1 : 0 };
      }

      const t = readAuthoredTimeline(html.html);
      const body = json
        ? JSON.stringify({ file: html.file, ...t, ok: true }, null, 2)
        : t.clips.map((c) => `${c.id.padEnd(18)} ${c.type.padEnd(12)} ${c.absStart.toFixed(2)}s → ${c.absEnd.toFixed(2)}s${c.src ? "  " + c.src : ""}`).join("\n") || "(no clips)";
      return ok(body);
    }

    if (HOST.has(sub)) {
      if (!opts.scratchDir) {
        return fail(`hyperframes ${sub}: needs the host CLI (Chrome + FFmpeg), which this hosted deployment does not have. Run the app locally for check/snapshot/render.`);
      }
      await materialise(ctx.fs, opts.workspace, opts.scratchDir);
      const res = await run(cli, [sub, ...rest], opts.scratchDir);
      let note = "";
      if (sub === "snapshot") {
        const copied = await collectSnapshots(ctx.fs, opts.workspace, opts.scratchDir);
        note = copied.length ? `\n[host] ${copied.length} frame(s) copied into the workspace; use readFile to look at them:\n${copied.map((c) => "  " + c).join("\n")}\n` : "";
      } else if (sub === "render") {
        note = `\n[host] renders are under ${path.join(opts.scratchDir, "renders")}\n`;
      }
      return { stdout: res.stdout + note, stderr: res.stderr, exitCode: res.code };
    }

    return fail(`hyperframes ${sub}: not available in this harness.\nIn-process: ${[...IN_PROCESS].join(", ")}. Host-bridged: ${[...HOST].join(", ")}.`);
  });
}

function help(host: boolean) {
  const h = (s: string) => (host ? s : "unavailable here (hosted mode)");
  return `hyperframes (just-bash bridge)
  lint [--json]        in-process linter (@hyperframes/lint) over index.html
  timeline [--json]    in-process clip list over index.html
  check [--json]       ${h("host CLI: lint + runtime + layout + contrast (Chrome)")}
  snapshot --at t,..   ${h("host CLI: PNG frames")}
  render [...]         ${h("host CLI: MP4")}`;
}

function ok(stdout: string) {
  return { stdout: stdout.endsWith("\n") ? stdout : stdout + "\n", stderr: "", exitCode: 0 };
}
function fail(msg: string) {
  return { stdout: "", stderr: msg.endsWith("\n") ? msg : msg + "\n", exitCode: 1 };
}

function formatLint(file: string, findings: { severity: string; message: string; elementId?: string }[]) {
  if (!findings.length) return `✓ ${file}: no findings`;
  return findings.map((f) => `${f.severity === "error" ? "✗" : "!"} ${f.severity}${f.elementId ? ` #${f.elementId}` : ""}: ${f.message}`).join("\n");
}

async function readProjectIndex(fs: IFileSystem, cwd: string, workspace: string) {
  for (const dir of [cwd, workspace]) {
    const file = path.posix.join(dir, "index.html");
    if (await fs.exists(file)) return { ok: true as const, file, html: await fs.readFile(file) };
  }
  return { ok: false as const, error: `index.html not found in ${cwd} or ${workspace}` };
}

/** Copy the virtual project tree to a host directory. */
async function materialise(fs: IFileSystem, from: string, to: string) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await walkVirtual(fs, from, async (vpath, rel) => {
    const dest = path.join(to, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await fs.readFileBuffer(vpath));
  });
}

/** Bring `snapshot` PNGs back from the scratch dir into the virtual fs (relative paths returned). */
async function collectSnapshots(fs: IFileSystem, workspace: string, scratch: string) {
  const dir = path.join(scratch, ".hyperframes/artifacts/snapshots");
  const out: string[] = [];
  try {
    await stat(dir);
  } catch {
    return out;
  }
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) {
        const rel = path.posix.join("snapshots", path.relative(dir, p).split(path.sep).join("/"));
        const vpath = path.posix.join(workspace, rel);
        await fs.mkdir(path.posix.dirname(vpath), { recursive: true });
        await fs.writeFile(vpath, new Uint8Array(await readFile(p)));
        out.push(rel);
      }
    }
  };
  await walk(dir);
  return out;
}

export async function walkVirtual(fs: IFileSystem, dir: string, onFile: (vpath: string, rel: string) => Promise<void>, base = dir) {
  for (const name of await fs.readdir(dir)) {
    if (name === "node_modules") continue;
    const p = path.posix.join(dir, name);
    const s = await fs.stat(p);
    if (s.isDirectory) await walkVirtual(fs, p, onFile, base);
    else await onFile(p, path.posix.relative(base, p));
  }
}

function run(cli: string[], args: string[], cwd: string) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const [cmd, ...pre] = cli;
    const child = spawn(cmd, [...pre, ...args], { cwd, env: { ...process.env, CI: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}
