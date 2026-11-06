/**
 * Image-aware readFile, after vercel-labs/bash-tool#22 ("Add image support to readFile via
 * toModelOutput"). Until that PR ships, this replaces bash-tool's readFile with one that
 * returns png/jpg/gif/webp as an image content part, so the model can look at attached
 * assets and at the frames `hyperframes snapshot` writes back into the workspace.
 */
import path from "node:path";
import { tool, jsonSchema, type JSONValue } from "ai";
import type { IFileSystem } from "just-bash";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

type ReadOutput = { data: string; mediaType: string; bytes: number } | { content: string };

export function createImageAwareReadFile(fs: IFileSystem, cwd: string) {
  return tool({
    description: "Read a file from the sandbox. Image files (png, jpg, jpeg, gif, webp) are returned as an image you can see.",
    inputSchema: jsonSchema<{ path: string }>({
      type: "object",
      properties: { path: { type: "string", description: "Path to the file, absolute or relative to the workspace" } },
      required: ["path"],
      additionalProperties: false,
    }),
    execute: async ({ path: p }): Promise<ReadOutput> => {
      const resolved = path.posix.resolve(cwd, p);
      const mediaType = IMAGE_TYPES[path.posix.extname(resolved).toLowerCase()];
      if (mediaType) {
        const bytes = await fs.readFileBuffer(resolved);
        return { data: Buffer.from(bytes).toString("base64"), mediaType, bytes: bytes.byteLength };
      }
      return { content: await fs.readFile(resolved) };
    },
    toModelOutput: ({ output }) =>
      "data" in output
        ? { type: "content" as const, value: [{ type: "image-data" as const, data: output.data, mediaType: output.mediaType }] }
        : { type: "json" as const, value: output as unknown as JSONValue },
  });
}
