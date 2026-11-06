// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

export const config = { maxDuration: 300 };
export default handle(app);
