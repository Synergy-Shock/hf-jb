/** Browser side of the virtual filesystem: a service worker answers /vfs/<path> from the
 *  files map, so the player's iframe can load compositions/… and assets/… like a real site. */

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerVfs() {
  if (!("serviceWorker" in navigator)) return (registration = Promise.resolve(null));
  registration ??= navigator.serviceWorker
    .register("/vfs-sw.js", { scope: "/" })
    .then(async (reg) => {
      await navigator.serviceWorker.ready;
      return reg;
    })
    .catch((e) => {
      console.warn("[vfs] service worker unavailable:", e);
      return null;
    });
  return registration;
}

/** Push the current files to the worker. Resolves when the worker acknowledges. */
export async function syncVfs(files: Record<string, string>): Promise<boolean> {
  const reg = await registerVfs();
  const sw = reg?.active ?? navigator.serviceWorker?.controller;
  if (!sw) return false;
  return new Promise((resolve) => {
    const onAck = (e: MessageEvent) => {
      if (e.data?.type === "files-ack") {
        navigator.serviceWorker.removeEventListener("message", onAck);
        resolve(true);
      }
    };
    navigator.serviceWorker.addEventListener("message", onAck);
    sw.postMessage({ type: "files", files });
    setTimeout(() => resolve(false), 3000);
  });
}

export const BINARY_PREFIX = "base64:";

export function fileToVfsEntry(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const url = String(r.result); // data:<mime>;base64,<payload>
      resolve(BINARY_PREFIX + url.slice(url.indexOf(",") + 1));
    };
    r.readAsDataURL(file);
  });
}

export const safeAssetName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
