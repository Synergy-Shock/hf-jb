import { useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type { Files } from "./App";
import { fileToVfsEntry, safeAssetName } from "./vfs";

interface Props {
  filesRef: React.RefObject<Files>;
  onFiles: (files: Files) => void;
  onAttach: (rel: string, content: string) => void;
}

export function Chat({ filesRef, onFiles, onAttach }: Props) {
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // The server streams the whole workspace back after each tool step.
    onData: (part) => {
      if (part.type === "data-files") onFiles(part.data as Files);
    },
  });
  const busy = status === "submitted" || status === "streaming";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && !attached.length) || busy) return;
    const note = attached.length ? `\n\n(Attached to /workspace: ${attached.join(", ")})` : "";
    sendMessage({ text: (text || "I attached files.") + note }, { body: { files: filesRef.current } });
    setInput("");
    setAttached([]);
  }

  async function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      const rel = `assets/${safeAssetName(f.name)}`;
      onAttach(rel, await fileToVfsEntry(f));
      setAttached((a) => (a.includes(rel) ? a : [...a, rel]));
    }
  }

  return (
    <section className="chat">
      <header className="bar">
        <strong>Chat</strong>
        <span className="muted">{status}</span>
      </header>
      <div className="messages">
        {messages.length === 0 && (
          <div className="muted hint">
            Try: “Make the title enter with a blur and switch the background to deep blue.” The agent edits
            /workspace/index.html with bash, runs <code>hyperframes lint</code>, and the player on the left reloads.
            Drop an image here to put it in <code>assets/</code>.
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {error && <div className="error">{error.message}</div>}
      </div>
      <form
        className={`composer${dragging ? " dragging" : ""}`}
        onSubmit={submit}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        {attached.length > 0 && (
          <div className="chips">
            {attached.map((a) => (
              <span key={a} className="chip">
                {a}
              </span>
            ))}
          </div>
        )}
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          placeholder={dragging ? "Drop to add to assets/" : "What should change in the video…"}
          rows={3}
        />
        <div className="actions">
          <input
            id="chat-attach"
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.svg,.json,.vtt,.srt"
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" className="ghost" onClick={() => fileInput.current?.click()} title="Attach a file into assets/">
            attach
          </button>
          {busy ? (
            <button type="button" onClick={() => stop()}>
              stop
            </button>
          ) : (
            <button type="submit">send</button>
          )}
        </div>
      </form>
    </section>
  );
}

function Message({ m }: { m: UIMessage }) {
  return (
    <div className={`msg msg-${m.role}`}>
      {m.parts.map((p, i) => {
        if (p.type === "text") return <p key={i}>{p.text}</p>;
        if (p.type.startsWith("tool-")) {
          const tp = p as { type: string; state: string; input?: unknown; output?: unknown };
          const name = tp.type.slice(5);
          const cmd = name === "bash" ? (tp.input as { command?: string } | undefined)?.command : JSON.stringify(tp.input);
          const out = tp.output as { stdout?: string; stderr?: string; exitCode?: number } | string | undefined;
          return (
            <details key={i} className="tool" open={tp.state !== "output-available"}>
              <summary>
                <code>{name}</code> {tp.state === "output-available" ? "✓" : "…"} <span className="muted">{truncate(cmd ?? "", 90)}</span>
              </summary>
              {typeof out === "object" && out && (
                <pre>
                  {out.stdout}
                  {out.stderr}
                  {out.exitCode !== undefined && `[exit ${out.exitCode}]`}
                </pre>
              )}
              {typeof out === "string" && <pre>{out}</pre>}
            </details>
          );
        }
        return null;
      })}
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
