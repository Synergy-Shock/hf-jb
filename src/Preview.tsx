import { useEffect, useMemo, useRef, useState } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import { readAuthoredTimeline, type Clip } from "../shared/timeline";
import type { Files } from "./App";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        srcdoc?: string;
        controls?: boolean;
        muted?: boolean;
        loop?: boolean;
      };
    }
  }
}

interface Props {
  files: Files;
  version: number;
  onFiles: (files: Files) => void;
}

export function Preview({ files, version, onFiles }: Props) {
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cmd, setCmd] = useState("hyperframes lint");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  const index = files["index.html"] ?? "";
  const timeline = useMemo(() => (index ? safeTimeline(index) : null), [index]);
  // Relative URLs inside srcdoc resolve against the parent page, so point them at the
  // service-worker-backed /vfs/ tree. The player injects the HyperFrames runtime itself.
  const srcdoc = useMemo(() => withBase(index, `${location.origin}/vfs/`) + `<!-- v${version} -->`, [index, version]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onTime = () => setTime(p.currentTime);
    const onReady = () => setDuration(p.duration);
    p.addEventListener("timeupdate", onTime);
    p.addEventListener("ready", onReady);
    p.addEventListener("durationchange", onReady);
    return () => {
      p.removeEventListener("timeupdate", onTime);
      p.removeEventListener("ready", onReady);
      p.removeEventListener("durationchange", onReady);
    };
  }, []);

  const total = Math.max(duration, timeline?.duration ?? 0, ...(timeline?.clips.map((c) => c.absEnd) ?? [0]), 1);
  const lanes = groupLanes(timeline?.clips ?? []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: cmd, files }) });
      const j = (await r.json()) as { stdout: string; stderr: string; exitCode: number; files: Files };
      setLog(`$ ${cmd}\n${j.stdout}${j.stderr}[exit ${j.exitCode}]`);
      onFiles(j.files);
    } catch (err) {
      setLog(`$ ${cmd}\n${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="preview">
      <header className="bar">
        <strong>HyperFrames · just-bash</strong>
        <span className="muted">
          v{version} · {timeline ? `${timeline.resolution.width}×${timeline.resolution.height}` : "…"} · {time.toFixed(2)}s / {total.toFixed(1)}s
        </span>
      </header>

      <div className="stage">
        <hyperframes-player ref={playerRef as React.Ref<HTMLElement>} srcdoc={srcdoc} controls muted />
      </div>

      <div className="timeline" onClick={(e) => seekFromClick(e, playerRef.current, total)}>
        <div className="ruler">
          {Array.from({ length: Math.ceil(total) + 1 }, (_, s) => (
            <span key={s} style={{ left: `${(s / total) * 100}%` }}>
              {s}s
            </span>
          ))}
        </div>
        {lanes.map((lane, i) => (
          <div className="lane" key={i}>
            {lane.map((c) => (
              <div
                key={c.id}
                className={`clip clip-${c.type}`}
                title={`${c.id} ${c.absStart}s → ${c.absEnd}s${c.src ? ` (${c.src})` : ""}`}
                style={{ left: `${(c.absStart / total) * 100}%`, width: `${((c.absEnd - c.absStart) / total) * 100}%` }}
              >
                {c.id}
              </div>
            ))}
          </div>
        ))}
        {!lanes.length && <div className="lane muted">no clips</div>}
        <div className="playhead" style={{ left: `${(time / total) * 100}%` }} />
      </div>

      <div className="files">
        <span className="muted">/workspace</span>
        {Object.entries(files).map(([rel, content]) => (
          <span key={rel} className="file" title={rel}>
            {rel} <em>{size(content)}</em>
          </span>
        ))}
      </div>

      <form className="term" onSubmit={run}>
        <input id="term-cmd" value={cmd} onChange={(e) => setCmd(e.target.value)} spellCheck={false} disabled={busy} />
        <button type="submit" disabled={busy}>
          {busy ? "…" : "run"}
        </button>
        <pre>{log || "sandbox: just-bash /workspace · hyperframes lint|timeline (in-process) · check|snapshot|render (host, local only)"}</pre>
      </form>
    </section>
  );
}

function safeTimeline(html: string) {
  try {
    return readAuthoredTimeline(html);
  } catch {
    return null;
  }
}

function withBase(html: string, href: string) {
  if (!html) return "";
  const tag = `<base href="${href}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

function size(content: string) {
  const bytes = content.startsWith("base64:") ? ((content.length - 7) * 3) / 4 : new Blob([content]).size;
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes | 0} B`;
}

/** Greedy lane packing: a clip goes to the first lane where it doesn't overlap. */
function groupLanes(clips: Clip[]): Clip[][] {
  const lanes: Clip[][] = [];
  for (const c of [...clips].sort((a, b) => a.absStart - b.absStart)) {
    const lane = lanes.find((l) => l.every((o) => o.absEnd <= c.absStart || o.absStart >= c.absEnd));
    if (lane) lane.push(c);
    else lanes.push([c]);
  }
  return lanes;
}

function seekFromClick(e: React.MouseEvent<HTMLDivElement>, p: HyperframesPlayer | null, total: number) {
  if (!p) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const t = ((e.clientX - rect.left) / rect.width) * total;
  p.seek(Math.max(0, Math.min(total, t)));
}
