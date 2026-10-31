// The film filter: one fixed recipe, repeatable per photo, sized for the roll, with its credit where it belongs.
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { LOOKS, applyFilmFilter } from "../lib/film.ts";
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
  const [w, n] = await Promise.all([applyFilmFilter(src, { ...off, watermark: "@some.guest" }), applyFilmFilter(src, { ...off, watermark: null })].map(async (p) => raw(await p)));
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
  expect(diff(W * 0.75, H - 60, W, H)).toBeGreaterThan(2); // bottom-right corner, where the credit sits
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

test("a panned frame smears the edges and keeps the middle (where the subject is) mostly sharp", async () => {
  // fine vertical stripes everywhere: a sideways smear erases them, so remaining contrast = remaining sharpness
  const W = 900, H = 600;
  const stripes = await sharp({ create: { width: W, height: H, channels: 3, background: "#808080" } })
    .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${Array.from({ length: W / 6 }, (_, i) => `<rect x="${i * 6}" width="3" height="${H}" fill="#202020"/>`).join("")}</svg>`) }])
    .jpeg({ quality: 95 }).toBuffer();
  const plain = { leak: { chance: 0, strength: 0, colors: [] }, shake: { chance: 0, strength: 1 }, dust: 0, scratches: 0, watermark: null, grain: { amount: 0, size: 1, shadowBoost: 0, chroma: 0 } };
  const panned = await applyFilmFilter(stripes, { ...plain, seed: 3, pan: { chance: 1, strength: 1 } });
  expect((await applyFilmFilter(stripes, { ...plain, seed: 3, pan: { chance: 1, strength: 1 } })).equals(panned)).toBe(true);
  const contrast = async (left: number) =>
    (await sharp(await sharp(panned).extract({ left, top: H / 2 - 50, width: 100, height: 100 }).greyscale().toBuffer()).stats()).channels[0].stdev; // stats() reads its input, so crop first
  expect(await contrast(W / 2 - 50)).toBeGreaterThan((await contrast(10)) * 1.5); // middle vs left edge
});

test("the night look has deeper blacks and brighter brights than the default", async () => {
  // a grey ramp from black to white
  const ramp = await sharp(Buffer.from(Array.from({ length: 256 * 64 * 3 }, (_, i) => Math.floor(i / 3) % 256)), { raw: { width: 256, height: 64, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const plain = { seed: 1, leak: { chance: 0, strength: 0, colors: [] }, shake: { chance: 0, strength: 1 }, pan: { chance: 0, strength: 1 }, dust: 0, scratches: 0, watermark: null, vignette: 0, grain: { amount: 0, size: 1, shadowBoost: 0, chroma: 0 } };
  const level = async (b: Buffer, left: number) =>
    (await sharp(await sharp(b).extract({ left, top: 16, width: 16, height: 32 }).greyscale().toBuffer()).stats()).channels[0].mean;
  const day = await applyFilmFilter(ramp, plain), night = await applyFilmFilter(ramp, { ...plain, ...LOOKS.night });
  expect(await level(night, 24)).toBeLessThan(await level(day, 24)); // shadows
  expect(await level(night, 216)).toBeGreaterThan(await level(day, 216)); // highlights
});

test("the credit is whoever took the photo; a long handle shrinks to fit, missing glyphs are skipped", async () => {
  const src = await testJpeg(1200, 900);
  const off = { leak: { chance: 0, strength: 0, colors: [] }, shake: { chance: 0, strength: 1 }, pan: { chance: 0, strength: 1 }, seed: 7 };
  const [a, b] = await Promise.all([applyFilmFilter(src, { ...off, watermark: "@maya" }), applyFilmFilter(src, { ...off, watermark: "@someone.else" })]);
  expect(a.equals(b)).toBe(false); // the text really is per photo
  await applyFilmFilter(src, { ...off, watermark: "@" + "x".repeat(30) }); // longest handle Instagram allows
  await applyFilmFilter(src, { ...off, watermark: "Zoë 🎃" }); // emoji the font doesn't have: dropped, no crash
});
