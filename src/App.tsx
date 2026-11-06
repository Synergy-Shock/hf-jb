import { useCallback, useEffect, useRef, useState } from "react";
import { Preview } from "./Preview";
import { Chat } from "./Chat";
import { SCAFFOLD } from "../shared/scaffold";
import { syncVfs } from "./vfs";

export type Files = Record<string, string>;

export default function App() {
  // The browser owns the project. Every request carries it; every response brings it back.
  const [files, setFilesState] = useState<Files>(SCAFFOLD);
  const [version, setVersion] = useState(0);
  const filesRef = useRef(files);

  const setFiles = useCallback((next: Files) => {
    filesRef.current = next;
    setFilesState(next);
    setVersion((v) => v + 1);
  }, []);

  // Mirror the files into the service worker so /vfs/<path> resolves for the player.
  useEffect(() => {
    syncVfs(files);
  }, [files]);

  const attach = useCallback(
    (rel: string, content: string) => setFiles({ ...filesRef.current, [rel]: content }),
    [setFiles],
  );

  return (
    <div className="shell">
      <Preview files={files} version={version} onFiles={setFiles} />
      <Chat filesRef={filesRef} onFiles={setFiles} onAttach={attach} />
    </div>
  );
}
