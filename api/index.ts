// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
// The Node runtime treats a default export as (req, res); Web-style handlers must be
// exported per HTTP method.
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

export const config = { maxDuration: 300 };

const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
