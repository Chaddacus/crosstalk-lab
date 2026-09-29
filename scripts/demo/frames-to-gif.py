"""
Assemble the screencast frames from scripts/demo/record-demo.ts into an animated GIF, an animated WebP and a
storyboard of key frames. Needs Pillow (pip install --user pillow). No ffmpeg needed.
  python scripts/demo/frames-to-gif.py [--fps 10] [--width 960]
"""
import argparse
import json
import os
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--frames", default="test-results/demo-frames")
ap.add_argument("--out", default="test-results/demo")
ap.add_argument("--fps", type=float, default=10)
ap.add_argument("--width", type=int, default=960)
args = ap.parse_args()

idx = json.load(open(os.path.join(args.frames, "index.json"), encoding="utf8"))
frames = sorted(idx["frames"], key=lambda f: f["t"])
marks = idx["marks"]
t0, t1 = marks[0]["t"], marks[-1]["t"]
W = args.width
H = round(idx["height"] * W / idx["width"])
os.makedirs(args.out, exist_ok=True)

cache = {}


def load(file):
    if file not in cache:
        cache.clear()
        cache[file] = Image.open(os.path.join(args.frames, file)).convert("RGB").resize((W, H), Image.LANCZOS)
    return cache[file]


# resample the variable-rate screencast onto a fixed timeline: each tick shows the latest frame at that time
ticks = []
i = 0
step = 1 / args.fps
t = t0
while t <= t1 + 1e-9:
    while i + 1 < len(frames) and frames[i + 1]["t"] <= t:
        i += 1
    ticks.append(frames[i]["file"])
    t += step

# one global palette from a spread of frames (stable colors, no flicker between frames)
sample = [load(ticks[k]) for k in range(0, len(ticks), max(1, len(ticks) // 16))]
mosaic = Image.new("RGB", (W, H * len(sample)))
for k, im in enumerate(sample):
    mosaic.paste(im, (0, H * k))
palette = mosaic.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

gif_frames, durations = [], []
webp_frames, webp_durations = [], []
last = None
for f in ticks:
    if f == last:
        durations[-1] += int(1000 / args.fps)
        webp_durations[-1] += int(1000 / args.fps)
        continue
    im = load(f)
    gif_frames.append(im.quantize(palette=palette, dither=Image.Dither.NONE))
    webp_frames.append(im.copy())
    durations.append(int(1000 / args.fps))
    webp_durations.append(int(1000 / args.fps))
    last = f

gif = os.path.join(args.out, "crosstalk-demo.gif")
gif_frames[0].save(gif, save_all=True, append_images=gif_frames[1:], duration=durations, loop=0, optimize=False, disposal=1)
webp = os.path.join(args.out, "crosstalk-demo.webp")
webp_frames[0].save(webp, save_all=True, append_images=webp_frames[1:], duration=webp_durations, loop=0, quality=72, method=4)

# storyboard: the frame on screen at each still the recorder marked
board = []
for k, sh in enumerate(idx.get("shots", []), start=1):
    j = max((n for n, fr in enumerate(frames) if fr["t"] <= sh["t"]), default=0)
    name = f"{k:02d}-{sh['label']}.png"
    Image.open(os.path.join(args.frames, frames[j]["file"])).convert("RGB").save(os.path.join(args.out, name), optimize=True)
    board.append(name)

secs = t1 - t0
print(f"{secs:.1f} s, {len(ticks)} ticks at {args.fps} fps, {len(gif_frames)} distinct frames")
for p in [gif, webp]:
    print(p, f"{os.path.getsize(p) / 1e6:.1f} MB")
print("storyboard:", ", ".join(board))
