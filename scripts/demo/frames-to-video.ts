/**
 * Encode the recorded screencast frames (scripts/demo/record-demo.ts) into a video with Chrome's own encoder
 * (MediaRecorder on a canvas), so no ffmpeg is needed. Prefers MP4 (H.264); falls back to WebM (VP9).
 * The frames are replayed in real time, so this takes as long as the clip.
 *   npx tsx scripts/demo/frames-to-video.ts [out-dir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const FRAMES = "test-results/demo-frames";
const OUT = process.argv[2] ?? "test-results/demo";
const FPS = 30;
const idx = JSON.parse(readFileSync(join(FRAMES, "index.json"), "utf8")) as { width: number; height: number; frames: { file: string; t: number }[]; marks: { t: number }[] };
const t0 = idx.marks[0]!.t;
const t1 = idx.marks[idx.marks.length - 1]!.t;
// resample onto a fixed timeline, keeping only the frames that change
const ticks: { file: string; at: number }[] = [];
let i = 0;
for (let k = 0; t0 + k / FPS <= t1; k++) {
  const t = t0 + k / FPS;
  while (i + 1 < idx.frames.length && idx.frames[i + 1]!.t <= t) i++;
  const file = idx.frames[i]!.file;
  if (!ticks.length || ticks[ticks.length - 1]!.file !== file) ticks.push({ file, at: (t - t0) * 1000 });
}
const durationMs = (t1 - t0) * 1000;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.route("http://frames.local/**", (route) => {
  const file = route.request().url().split("/").pop()!;
  if (file === "index.html") return route.fulfill({ body: "<!doctype html><canvas id=c></canvas>", contentType: "text/html" });
  return route.fulfill({ body: readFileSync(join(FRAMES, file)), contentType: "image/png" });
});
// tsx keeps function names with a __name() helper; give the page a no-op one for the evaluated code
await page.addInitScript("window.__name = (f) => f");
// a same-origin page, so the frames can be fetched and drawn without tainting the canvas
await page.goto("http://frames.local/index.html");
const result = await page.evaluate(
  async ({ ticks, width, height, durationMs }) => {
    const types = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const type = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return { error: "no supported MediaRecorder type" };
    const c = document.getElementById("c") as HTMLCanvasElement;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const load = async (file: string) => createImageBitmap(await (await fetch(`http://frames.local/${file}`)).blob());
    const first = await load(ticks[0]!.file);
    ctx.drawImage(first, 0, 0);
    // a small look-ahead buffer of decoded frames
    const ahead = new Map<number, Promise<ImageBitmap>>();
    const want = (n: number) => {
      for (let k = n; k < Math.min(ticks.length, n + 8); k++) if (!ahead.has(k)) ahead.set(k, load(ticks[k]!.file));
    };
    want(1);
    rec.start(1000);
    const start = performance.now();
    let cur = first;
    // keep repainting the current frame while waiting, so static stretches (and the end card) keep their length
    const holdUntil = async (at: number) => {
      for (;;) {
        const left = at - (performance.now() - start);
        if (left <= 0) return;
        ctx.drawImage(cur, 0, 0);
        await new Promise((r) => setTimeout(r, Math.min(100, left)));
      }
    };
    for (let n = 1; n < ticks.length; n++) {
      const bmp = await ahead.get(n)!;
      ahead.delete(n);
      want(n + 1);
      await holdUntil(ticks[n]!.at);
      ctx.drawImage(bmp, 0, 0);
      cur.close();
      cur = bmp;
    }
    await holdUntil(durationMs);
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    const blob = new Blob(chunks, { type });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
    return { type, data: btoa(bin), late: performance.now() - start - durationMs };
  },
  { ticks, width: idx.width, height: idx.height, durationMs },
);
await browser.close();
if ("error" in result) throw new Error(result.error);
mkdirSync(OUT, { recursive: true });
const ext = result.type!.startsWith("video/mp4") ? "mp4" : "webm";
const file = join(OUT, `crosstalk-demo.${ext}`);
writeFileSync(file, Buffer.from(result.data!, "base64"));
console.log(`${file} (${result.type}), ${(Buffer.from(result.data!, "base64").length / 1e6).toFixed(1)} MB, ${ticks.length} distinct frames, ${(durationMs / 1000).toFixed(1)} s`);
