// The film filter: one fixed recipe, repeatable per photo, sized for the roll, with its credit where it belongs.
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { applyFilmFilter } from "../lib/film.ts";
import { testJpeg } from "./support.ts";

const raw = async (jpg: Buffer) => sharp(jpg).raw().toBuffer({ resolveWithObject: true });

test("same photo + seed → same frame; another seed → different grain and dust", async () => {
  const src = await testJpeg(800, 600);
  const a = await applyFilmFilter(src, { seed: 42 });
  expect((await applyFilmFilter(src, { seed: 42 })).equals(a)).toBe(true);
  expect((await applyFilmFilter(src, { seed: 43 })).equals(a)).toBe(false);
});

test("output is the 2000px roll size, never upscaled, and upright", async () => {
  expect(await sharp(await applyFilmFilter(await testJpeg(3000, 2000))).metadata()).toMatchObject({ width: 2000, height: 1333 });
  expect(await sharp(await applyFilmFilter(await testJpeg(1200, 900))).metadata()).toMatchObject({ width: 1200, height: 900 });
  // a phone photo shot sideways: pixels landscape, EXIF says rotate 90°
  const sideways = await sharp(await testJpeg(1200, 900)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  expect(await sharp(await applyFilmFilter(sideways)).metadata()).toMatchObject({ width: 900, height: 1200 });
});

test("developed frames carry no EXIF (no GPS, no phone model)", async () => {
  const tagged = await sharp(await testJpeg()).withExif({ IFD0: { Make: "Phone", Model: "Test" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 36/1 0/1" } }).jpeg().toBuffer();
  expect((await sharp(tagged).metadata()).exif).toBeDefined();
  expect((await sharp(await applyFilmFilter(tagged)).metadata()).exif).toBeUndefined();
});

test("watermark sits bottom-right, and only there", async () => {
  const src = await testJpeg(1200, 900);
  const off = { leak: { chance: 0, strength: 0, colors: [] }, seed: 7 };
  const [w, n] = await Promise.all([applyFilmFilter(src, { ...off, watermark: true }), applyFilmFilter(src, { ...off, watermark: false })].map(async (p) => raw(await p)));
  const diff = (x0: number, y0: number, x1: number, y1: number) => {
    let d = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) {
      const i = (y * w.info.width + x) * 3 + c;
      d += Math.abs(w.data[i] - n.data[i]);
    }
    return d / ((x1 - x0) * (y1 - y0) * 3); // mean change per channel value
  };
  const { width: W, height: H } = w.info;
  // JPEG re-encoding jitters a few values everywhere; the watermark changes the corner by far more than that.
  expect(diff(W / 2, H - 90, W, H)).toBeGreaterThan(2); // bottom-right strip
  expect(diff(0, H - 90, W / 3, H)).toBeLessThan(0.2); // bottom-left untouched
  expect(diff(0, 0, W, H / 2)).toBeLessThan(0.2); // top half untouched
});

test("light leaks land on roughly a quarter of frames", async () => {
  const src = await testJpeg(240, 180);
  let leaks = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    // same seed with leaks impossible: identical output means this frame drew no leak
    const [a, b] = await Promise.all([applyFilmFilter(src, { seed }), applyFilmFilter(src, { seed, leak: { chance: 0, strength: 0.5, colors: ["#ff6a3d"] } })]);
    if (!a.equals(b)) leaks++;
  }
  expect(leaks / N).toBeGreaterThan(0.17);
  expect(leaks / N).toBeLessThan(0.33);
});

test("an overlay is screened on, placed the same way for the same seed and differently for another", async () => {
  const src = await testJpeg(800, 600);
  // a stand-in artifact (the licensed ones never go in the repo): a warm streak on black
  const overlay = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#000" } })
    .composite([{ input: Buffer.from('<svg width="1600" height="900"><rect x="300" y="0" width="250" height="900" fill="#ff7a3d"/></svg>') }])
    .jpeg().toBuffer();
  const none = await applyFilmFilter(src, { seed: 9, leak: { chance: 0, strength: 0, colors: [] } });
  const a = await applyFilmFilter(src, { seed: 9, overlay: { image: overlay, strength: 1 } });
  expect(a.equals(none)).toBe(false);
  expect((await applyFilmFilter(src, { seed: 9, overlay: { image: overlay, strength: 1 } })).equals(a)).toBe(true);
  expect((await applyFilmFilter(src, { seed: 10, overlay: { image: overlay, strength: 1 } })).equals(a)).toBe(false);
  // screen only adds light: the frame never gets darker on average
  const mean = async (b: Buffer) => (await sharp(b).stats()).channels.slice(0, 3).reduce((s, c) => s + c.mean, 0);
  expect(await mean(a)).toBeGreaterThan(await mean(none));
});

test("a dragged shutter ghosts the frame, the same way for the same seed", async () => {
  const src = await testJpeg(800, 600);
  const still = await applyFilmFilter(src, { seed: 4, shake: { chance: 0, strength: 1 } });
  const shaken = await applyFilmFilter(src, { seed: 4, shake: { chance: 1, strength: 1 } });
  expect(shaken.equals(still)).toBe(false);
  expect((await applyFilmFilter(src, { seed: 4, shake: { chance: 1, strength: 1 } })).equals(shaken)).toBe(true);
  // the ghost smears edges: less fine detail than the still frame
  const detail = async (b: Buffer) => (await sharp(b).greyscale().stats()).sharpness;
  expect(await detail(shaken)).toBeLessThan(await detail(still));
});
