# hf-jb — HyperFrames × just-bash × AI SDK

A chat-driven video editor: the agent edits a [HyperFrames](https://github.com/heygen-com/hyperframes)
composition inside a [just-bash](https://github.com/vercel-labs/just-bash) virtual filesystem, and the
`<hyperframes-player>` next to the chat reloads after every tool call.

```
browser                                   server (Node locally / Vercel function)
┌──────────────────────┐   POST /api/chat  ┌──────────────────────────────────────┐
│ files map (state)    │ ───────────────▶  │ InMemoryFs(files) → Bash             │
│  ├ index.html        │  {messages,files} │   custom cmd `hyperframes`           │
│  └ assets/lucho.png  │                   │     lint/timeline  → in-process JS   │
│                      │  ◀─── UI stream   │     check/snapshot → host CLI (local)│
│ service worker       │  data-files parts │ AI SDK streamText + bash-tool tools  │
│  /vfs/* ← files      │                   │ readFile returns images (PR #22)     │
│ <hyperframes-player  │                   └──────────────────────────────────────┘
│   srcdoc + <base     │
│   href=/vfs/>>       │
└──────────────────────┘
```

- **State lives in the browser.** Every request carries the files; every tool step streams the updated
  files back (`data-files`). That is what makes the server stateless enough for Vercel.
- **`hyperframes` is a `defineCommand`.** `lint` and `timeline` run in-process from `@hyperframes/lint`
  and a DOM scan. `check`, `snapshot` and `render` materialise the virtual tree to `.hf-scratch/` and run
  the real CLI (Chrome + FFmpeg): local only. Snapshot PNGs are copied back into `/workspace/snapshots/`
  so the agent can `readFile` them and look at its own frames.
- **The player reads the virtual filesystem.** A service worker answers `/vfs/<path>` from the files map,
  and the composition is loaded as `srcdoc` with `<base href="/vfs/">`, so `assets/…` and
  `compositions/…` resolve without a server.

## Run

```bash
npm install
echo "ANTHROPIC_API_KEY=<your key>" > .env
npm run dev          # api on :8787, vite on :5173
npm run smoke        # sandbox + bridged command, no model
npm run e2e          # real Chrome: attach ~/Desktop/lucho.png, chat, screenshot
```

The system prompt embeds the HyperFrames skill from `~/.claude/skills/hyperframes` when present
(`npm run sync` refreshes `shared/skill-bundle.ts` and `shared/scaffold.ts`).
