/* Serves the browser-held virtual filesystem at /vfs/<path>, so the composition's relative
 * compositions/… and assets/… URLs resolve without a server. Files are kept in the Cache API
 * so they survive the service worker being stopped and restarted. */
const CACHE = "hf-vfs";
const MIME = {
  html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", vtt: "text/vtt",
};
const mime = (p) => MIME[p.split(".").pop().toLowerCase()] || "application/octet-stream";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  if (e.data?.type !== "files") return;
  const files = e.data.files || {};
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const req of await cache.keys()) await cache.delete(req);
      for (const [rel, content] of Object.entries(files)) {
        let body = content;
        if (typeof content === "string" && content.startsWith("base64:")) {
          const bin = atob(content.slice(7));
          body = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        }
        await cache.put(new Request(self.location.origin + "/vfs/" + rel), new Response(body, { headers: { "content-type": mime(rel), "cache-control": "no-store" } }));
      }
      e.source?.postMessage({ type: "files-ack", count: Object.keys(files).length });
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/vfs/")) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(new Request(url.origin + url.pathname));
      return hit || new Response("vfs: not found " + url.pathname, { status: 404, headers: { "content-type": "text/plain" } });
    })(),
  );
});
