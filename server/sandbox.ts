/**
 * A just-bash sandbox built per request from a files map. The project lives in an
 * in-memory filesystem under /workspace; the caller gets the files back when done, so the
 * state can live in the browser (and survive stateless serverless invocations).
 */
import { Bash, InMemoryFs } from "just-bash";
import type { IFileSystem } from "just-bash";
import path from "node:path";
import { createHyperframesCommand, walkVirtual } from "./hf-bridge.js";

export const WORKSPACE = "/workspace";

export interface SandboxHandle {
  bash: Bash;
  fs: IFileSystem;
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Export the whole workspace as a path -> text map (binary files are base64 with a prefix). */
  snapshot: () => Promise<Record<string, string>>;
}

export const BINARY_PREFIX = "base64:";
const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md", ".csv", ".vtt", ".srt"]);

export function createSandbox(opts: { files: Record<string, string>; scratchDir?: string }): SandboxHandle {
  const initial: Record<string, string | Uint8Array> = {};
  for (const [rel, content] of Object.entries(opts.files)) {
    initial[path.posix.join(WORKSPACE, rel)] = content.startsWith(BINARY_PREFIX) ? new Uint8Array(Buffer.from(content.slice(BINARY_PREFIX.length), "base64")) : content;
  }
  const fs = new InMemoryFs(initial);
  const hyperframes = createHyperframesCommand({ workspace: WORKSPACE, scratchDir: opts.scratchDir });
  const bash = new Bash({ fs, cwd: WORKSPACE, customCommands: [hyperframes] });

  return {
    bash,
    fs,
    async exec(cmd) {
      const r = await bash.exec(cmd);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
    },
    async snapshot() {
      const out: Record<string, string> = {};
      await walkVirtual(fs, WORKSPACE, async (vpath, rel) => {
        if (TEXT_EXT.has(path.posix.extname(rel).toLowerCase())) out[rel] = await fs.readFile(vpath);
        else out[rel] = BINARY_PREFIX + Buffer.from(await fs.readFileBuffer(vpath)).toString("base64");
      });
      return out;
    },
  };
}
