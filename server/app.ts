/**
 * Stateless HTTP surface: the browser owns the project files and sends them with every
 * request; the server rebuilds a just-bash sandbox from them, runs the agent (or one shell
 * line), and streams the updated files back. Runs the same on Node locally and on Vercel.
 */
import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createBashTool } from "bash-tool";
import path from "node:path";
import { createSandbox, WORKSPACE } from "./sandbox.js";
import { buildSystemPrompt } from "./prompt.js";
import { createImageAwareReadFile } from "./tools.js";

const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
/** Host-bridged commands (Chrome + FFmpeg) only when running on a real machine. */
const HOST_TOOLS = !process.env.VERCEL && process.env.HF_HOST_TOOLS !== "0";
const SCRATCH = HOST_TOOLS ? path.resolve(process.cwd(), ".hf-scratch") : undefined;

type Files = Record<string, string>;

export const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, model: MODEL, hostTools: HOST_TOOLS, key: !!process.env.ANTHROPIC_API_KEY }));

app.post("/api/chat", async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) return c.json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  const { messages, files = {} } = (await c.req.json()) as { messages: UIMessage[]; files?: Files };

  const sb = createSandbox({ files, scratchDir: SCRATCH });
  const { tools: bashTools } = await createBashTool({ sandbox: sb.bash, destination: WORKSPACE });
  const tools = { ...bashTools, readFile: createImageAwareReadFile(sb.fs, WORKSPACE) };
  const system = (await buildSystemPrompt({ hostTools: HOST_TOOLS })) + `\n\nFiles currently in /workspace:\n${Object.keys(files).map((f) => "  " + f).join("\n") || "  (empty)"}`;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const pushFiles = async () => writer.write({ type: "data-files", data: await sb.snapshot(), transient: true });
      const result = streamText({
        model: anthropic(MODEL),
        system,
        messages: await convertToModelMessages(messages),
        tools,
        stopWhen: stepCountIs(25),
        // After every tool step the browser gets the new files, so the player reloads live.
        onStepFinish: pushFiles,
      });
      writer.merge(result.toUIMessageStream());
      await result.response;
      await pushFiles();
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
  });
  return createUIMessageStreamResponse({ stream });
});

/** One shell line in a sandbox built from the given files (the UI's terminal). */
app.post("/api/exec", async (c) => {
  const { command, files = {} } = (await c.req.json()) as { command: string; files?: Files };
  const sb = createSandbox({ files, scratchDir: SCRATCH });
  const r = await sb.exec(command);
  return c.json({ ...r, files: await sb.snapshot() });
});
