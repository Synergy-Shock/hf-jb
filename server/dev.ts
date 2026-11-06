import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[hf-jb] api http://localhost:${PORT}  key=${process.env.ANTHROPIC_API_KEY ? "set" : "MISSING"}  hostTools=${!process.env.VERCEL}`);
});
