/**
 * What `hyperframes timeline --json` reports, read from the authored attributes
 * (data-start, data-duration) so ids stay the ones the agent wrote.
 * Isomorphic: uses the global DOMParser (native in the browser, linkedom on the server).
 */
export interface Clip {
  id: string;
  type: "composition" | "video" | "audio" | "img" | "graphics";
  absStart: number;
  absEnd: number;
  duration: number;
  track: number;
  src?: string;
}

export interface Timeline {
  rootId: string | null;
  duration: number;
  resolution: { width: number; height: number };
  clips: Clip[];
}

export function readAuthoredTimeline(html: string): Timeline {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("[data-composition-id][data-duration]");
  const duration = Number(root?.getAttribute("data-duration") ?? 0);
  const width = Number(root?.getAttribute("data-width") ?? 1920);
  const height = Number(root?.getAttribute("data-height") ?? 1080);
  const clips: Clip[] = Array.from(doc.querySelectorAll("[data-start]"))
    .filter((el) => el !== root)
    .map((el) => {
      const tag = el.tagName.toLowerCase();
      const start = Number(el.getAttribute("data-start") ?? 0);
      const dur = Number(el.getAttribute("data-duration") ?? (tag === "img" ? 3 : duration - start));
      const type: Clip["type"] = el.hasAttribute("data-composition-src")
        ? "composition"
        : tag === "video" || tag === "audio" || tag === "img"
          ? tag
          : "graphics";
      return {
        id: el.id || `(${tag})`,
        type,
        absStart: start,
        absEnd: start + dur,
        duration: dur,
        track: Number(el.getAttribute("data-track-index") ?? 0),
        src: el.getAttribute("data-composition-src") ?? el.getAttribute("src") ?? undefined,
      };
    })
    .sort((a, b) => a.absStart - b.absStart);
  return { rootId: root?.getAttribute("data-composition-id") ?? null, duration, resolution: { width, height }, clips };
}
