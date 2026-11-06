// End-to-end check with real Chrome: load the UI, confirm the player and timeline render,
// attach an image into the virtual filesystem, send a chat message, wait for the agent to
// edit the project and lint it, then screenshot.
//   node scripts/e2e.mjs [--url http://localhost:5173/] [--image ~/Desktop/lucho.png] [--out dir]
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = opt("--out", "e2e-out");
const URL = opt("--url", "http://localhost:5173/");
const IMAGE = opt("--image", `${os.homedir()}/Desktop/lucho.png`);
const PROMPT = opt(
  "--prompt",
  "Make an 8 second video: dark navy background, the image assets/lucho.png centered at 420px wide fading in with a slight scale-up at 0.5s, and the title \"Lucho\" sliding up under it at 2s. Run hyperframes lint at the end.",
);
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-first-run", "--window-size=1500,900", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1500, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForSelector("hyperframes-player");
const ready = await page.evaluate(() => new Promise((res) => {
  const p = document.querySelector("hyperframes-player");
  if (p.ready) return res({ ready: true, duration: p.duration });
  const t = setTimeout(() => res({ ready: false, duration: p.duration }), 20000);
  p.addEventListener("ready", () => { clearTimeout(t); res({ ready: true, duration: p.duration }); }, { once: true });
}));
console.log("player:", JSON.stringify(ready));
console.log("timeline clips before:", await page.$$eval(".timeline .clip", (els) => els.map((e) => e.textContent)));
await page.screenshot({ path: `${OUT}/01-loaded.png` });

// attach the image through the hidden file input
const input = await page.$("#chat-attach");
await input.uploadFile(IMAGE);
await page.waitForSelector(".chip");
console.log("attached:", await page.$$eval(".chip", (els) => els.map((e) => e.textContent)));
// the service worker must serve it
const served = await page.evaluate(async () => { const r = await fetch("/vfs/assets/lucho.png"); return { status: r.status, type: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength }; });
console.log("vfs serves asset:", JSON.stringify(served));

await page.type("#chat-input", PROMPT);
await page.click(".composer button[type=submit]");
console.log("sent prompt; waiting for the agent…");
const t0 = Date.now();
await page.waitForFunction(
  () => document.querySelector(".chat .bar .muted")?.textContent === "ready" && document.querySelectorAll(".msg-assistant").length > 0,
  { timeout: 240000, polling: 1000 },
);
console.log(`agent finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("tool calls:\n  " + (await page.$$eval(".tool summary", (els) => els.map((e) => e.textContent.trim()))).join("\n  "));
console.log("assistant:", (await page.$$eval(".msg-assistant p", (els) => els.map((e) => e.textContent).join("\n"))).slice(0, 600));

const idx = await page.evaluate(async () => (await fetch("/vfs/index.html")).text());
console.log("index.html references lucho:", /assets\/lucho\.png/.test(idx), "| has fromTo:", /fromTo\(/.test(idx));
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => document.querySelector("hyperframes-player")?.seek(3));
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/02-after-agent.png` });
console.log("timeline clips after:", await page.$$eval(".timeline .clip", (els) => els.map((e) => e.textContent)));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
