import sharp, { type OverlayOptions } from "sharp";
import { WATERMARK } from "./watermark.ts";

type RGB = [number, number, number];

// One fixed recipe, applied the same way to every photo. No per-photo analysis.
export type FilmOptions = {
  maxEdge: number; // output long edge in px (disposable scans are ~2000)
  exposure: number; // brightness gain before the film curve
  gamma: number; // <1 lifts shadows and midtones, >1 deepens them
  shoulder: number; // where highlights start rolling off (0..1)
  contrast: number; // S-curve strength 0..1
  blackPoint: RGB; // faded, tinted blacks (0..1 per channel)
  whitePoint: RGB; // capped, warm whites
  shadowTint: RGB; // per-channel multiplier, fades in toward the shadows
  saturation: number;
  warmth: number; // pushes red up / blue down (skin)
  halation: { strength: number; threshold: number; radius: number; color: RGB }; // glow around bright spots; radius = fraction of long edge
  grain: { amount: number; size: number; shadowBoost: number; chroma: number };
  vignette: number; // 0..1 corner darkening
  softness: number; // blur sigma in px, 0 = off
  leak: { chance: number; strength: number; colors: string[] }; // light leak from the film edge
  dust: number; // dust specks and hairs, 0 = clean scan
  scratches: number; // chance of a long scratch
  dateStamp: Date | null; // orange LED date in the corner
  watermark: boolean; // faint credit in the bottom-right corner (text set in lib/watermark.ts)
  seed: number; // same seed = same grain, leaks and dust. Use a per-photo value
  quality: number; // jpeg quality
};

// Tuned against real disposable scans: crisp, deep rich colour, near-black blacks with a slight
// olive lift, warm mids, highlights allowed to blow out. A strong S-curve does the "near is blown,
// background is dark" look without any subject detection.
export const DEFAULT_FILM: FilmOptions = {
  maxEdge: 2000,
  exposure: 1.0,
  gamma: 1.0,
  shoulder: 0.85,
  contrast: 0.8,
  blackPoint: [0.04, 0.062, 0.025],
  whitePoint: [0.96, 0.98, 0.93],
  shadowTint: [0.88, 1.0, 0.82],
  saturation: 1.2,
  warmth: 0.15,
  halation: { strength: 0.35, threshold: 0.85, radius: 0.01, color: [1, 0.32, 0.12] },
  grain: { amount: 0.06, size: 1.3, shadowBoost: 1.0, chroma: 0.3 },
  vignette: 0.45,
  softness: 0.4,
  leak: { chance: 0.25, strength: 0.5, colors: ["#ff6a3d", "#ff9a6b", "#ff8fa3", "#ffd27a"] },
  dust: 2.6,
  scratches: 0.3,
  dateStamp: null,
  watermark: true,
  seed: 1,
  quality: 86,
};

// Deep-merges one level so callers can pass e.g. { grain: { amount: 0.1 } }.
export function filmOptions(partial: Partial<FilmOptions> = {}): FilmOptions {
  const o = { ...DEFAULT_FILM } as Record<string, unknown>;
  for (const [k, v] of Object.entries(partial)) {
    const base = o[k];
    o[k] =
      v && base && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
        ? { ...(base as object), ...(v as object) }
        : v;
  }
  return o as FilmOptions;
}

function isHeic(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString("latin1", 4, 8) !== "ftyp") return false;
  return ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(buf.toString("latin1", 8, 12));
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Original buffer in (JPEG/PNG/HEIC/...), filtered JPEG out. Output carries no EXIF/GPS. */
export async function applyFilmFilter(input: Buffer, partial: Partial<FilmOptions> = {}): Promise<Buffer> {
  const o = filmOptions(partial);
  // heic-convert is a big decoder only iPhone uploads need: load it on demand to keep cold starts short.
  const convert = isHeic(input) ? (await import("heic-convert")).default : null;
  const src = convert ? Buffer.from(await convert({ buffer: input, format: "JPEG", quality: 0.95 })) : input;

  const { data, info } = await sharp(src)
    .rotate() // apply EXIF orientation
    .resize(o.maxEdge, o.maxEdge, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const long = Math.max(w, h);
  const raw1 = { raw: { width: w, height: h, channels: 1 as const } };
  const raw3 = { raw: { width: w, height: h, channels: 3 as const } };

  // Bright spots, blurred, become the halation glow.
  const bright = Buffer.alloc(n);
  const ht = o.halation.threshold;
  for (let i = 0; i < n; i++) {
    const lum = ((0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]) / 255) * o.exposure;
    bright[i] = lum > ht ? Math.min(255, ((lum - ht) / (1 - ht)) * 255) : 0;
  }
  const [glow, noise] = await Promise.all([
    o.halation.strength > 0
      ? sharp(bright, raw1).blur(Math.max(0.3, o.halation.radius * long)).extractChannel(0).raw().toBuffer() // sharp outputs 3 channels otherwise
      : null,
    grainNoise(w, h, o.grain.size, o.seed),
  ]);

  const out = Buffer.alloc(n * 3);
  const k = o.shoulder, hc = o.halation.color;
  const halfDiag2 = (w / 2) ** 2 + (h / 2) ** 2;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const vd = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / halfDiag2;
      const gain = o.exposure * (1 - o.vignette * vd * vd);
      const halo = glow ? (glow[i] / 255) * o.halation.strength : 0;
      let r = ((data[i * 3] / 255) * gain) ** o.gamma + halo * hc[0];
      let g = ((data[i * 3 + 1] / 255) * gain) ** o.gamma + halo * hc[1];
      let b = ((data[i * 3 + 2] / 255) * gain) ** o.gamma + halo * hc[2];

      // soft highlight roll-off instead of a digital clip
      r = r < k ? r : k + (1 - k) * (1 - Math.exp(-(r - k) / (1 - k)));
      g = g < k ? g : k + (1 - k) * (1 - Math.exp(-(g - k) / (1 - k)));
      b = b < k ? b : k + (1 - k) * (1 - Math.exp(-(b - k) / (1 - k)));

      // S-curve
      r += o.contrast * (r * r * (3 - 2 * r) - r);
      g += o.contrast * (g * g * (3 - 2 * g) - g);
      b += o.contrast * (b * b * (3 - 2 * b) - b);

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * o.saturation;
      g = lum + (g - lum) * o.saturation;
      b = lum + (b - lum) * o.saturation;
      r *= 1 + 0.1 * o.warmth;
      b *= 1 - 0.18 * o.warmth;
      const sh = (1 - lum) * (1 - lum);
      r *= 1 + (o.shadowTint[0] - 1) * sh;
      g *= 1 + (o.shadowTint[1] - 1) * sh;
      b *= 1 + (o.shadowTint[2] - 1) * sh;

      r = o.blackPoint[0] + clamp01(r) * (o.whitePoint[0] - o.blackPoint[0]);
      g = o.blackPoint[1] + clamp01(g) * (o.whitePoint[1] - o.blackPoint[1]);
      b = o.blackPoint[2] + clamp01(b) * (o.whitePoint[2] - o.blackPoint[2]);

      // grain: luma noise, stronger in shadows, with a little per-channel colour noise
      const amp = o.grain.amount * (1 + o.grain.shadowBoost * (1 - lum) * (1 - lum));
      const nl = (noise[i * 3] - 128) / 128;
      const nr = (noise[i * 3 + 1] - 128) / 128;
      const nb = (noise[i * 3 + 2] - 128) / 128;
      r += amp * (nl + o.grain.chroma * (nr - nl));
      g += amp * nl;
      b += amp * (nl + o.grain.chroma * (nb - nl));

      out[i * 3] = clamp01(r) * 255 + 0.5;
      out[i * 3 + 1] = clamp01(g) * 255 + 0.5;
      out[i * 3 + 2] = clamp01(b) * 255 + 0.5;
    }
  }

  // Soften first as its own step so dust and the stamp composited on top stay crisp.
  const base = o.softness >= 0.3 ? await sharp(out, raw3).blur(o.softness).raw().toBuffer() : out;
  const rand = mulberry32(o.seed ^ 0x9e3779b9);
  const layers: OverlayOptions[] = [];
  if (rand() < o.leak.chance) layers.push({ input: Buffer.from(leakSvg(w, h, rand, o.leak)), blend: "screen" });
  if (o.dust > 0 || o.scratches > 0) layers.push({ input: Buffer.from(dustSvg(w, h, rand, o.dust, rand() < o.scratches)) });
  if (o.dateStamp) layers.push({ input: Buffer.from(dateStampSvg(o.dateStamp, w, h)) });
  let img = sharp(base, raw3);
  if (o.watermark) {
    // Composite everything else first, so the watermark can read the final corner (leaks included).
    const flat = layers.length ? await img.composite(layers).removeAlpha().raw().toBuffer() : base;
    const box = watermarkBox(w, h);
    img = sharp(flat, raw3).composite([{ input: Buffer.from(watermarkSvg(w, h, box, meanLuma(flat, w, box) > 0.55)) }]);
  } else if (layers.length) {
    img = img.composite(layers);
  }
  return img.jpeg({ quality: o.quality, mozjpeg: true }).toBuffer(); // sharp drops EXIF (incl. GPS)
}

// Random RGB noise at reduced resolution, upscaled so grain clumps instead of being per-pixel.
async function grainNoise(w: number, h: number, size: number, seed: number): Promise<Buffer> {
  const rand = mulberry32(seed);
  const gw = Math.max(1, Math.round(w / size)), gh = Math.max(1, Math.round(h / size));
  const raw = Buffer.alloc(gw * gh * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = rand() * 256;
  return sharp(raw, { raw: { width: gw, height: gh, channels: 3 } })
    .resize(w, h, { kernel: "cubic", fit: "fill" })
    .raw()
    .toBuffer();
}

// Soft blobs bleeding in from one film edge, composited with "screen".
function leakSvg(w: number, h: number, rand: () => number, leak: FilmOptions["leak"]): string {
  const edge = rand() < 0.5 ? 0 : w;
  const blobs = Array.from({ length: 2 + Math.floor(rand() * 2) }, (_, i) => {
    const c = leak.colors[Math.floor(rand() * leak.colors.length)];
    const cx = edge === 0 ? rand() * w * 0.08 : w - rand() * w * 0.08;
    return `<radialGradient id="l${i}"><stop offset="0" stop-color="${c}" stop-opacity="${leak.strength * (0.6 + rand() * 0.4)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
    <ellipse cx="${cx}" cy="${h * (0.1 + rand() * 0.8)}" rx="${w * (0.15 + rand() * 0.3)}" ry="${h * (0.3 + rand() * 0.5)}" fill="url(#l${i})"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${blobs.join("")}</svg>`;
}

// Dust on the negative prints as white specks; plus a few hairs and maybe a long scratch.
function dustSvg(w: number, h: number, rand: () => number, amount: number, scratch: boolean): string {
  const s = Math.max(w, h) / 2000;
  const parts: string[] = [];
  for (let i = 0, specks = Math.round(amount * (12 + rand() * 25)); i < specks; i++) {
    const c = rand();
    const fill = c < 0.75 ? "#fffbea" : c < 0.9 ? "#ffc9a0" : "#1a1a12"; // mostly white, some warm, a few dark
    parts.push(`<ellipse cx="${rand() * w}" cy="${rand() * h}" rx="${(0.6 + rand() * 2.2) * s}" ry="${(0.5 + rand() * 1.6) * s}" fill="${fill}" opacity="${0.35 + rand() * 0.5}"/>`);
  }
  // curly fibres: cubic curves with wild control points loop back on themselves
  for (let i = 0, hairs = Math.round(amount * (2 + rand() * 5)); i < hairs; i++) {
    const x = rand() * w, y = rand() * h, len = (20 + rand() * 120) * s, a = rand() * Math.PI * 2;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const c = () => (rand() - 0.5) * len * 1.6;
    parts.push(`<path d="M${x} ${y}C${x + c()} ${y + c()} ${ex + c()} ${ey + c()} ${ex} ${ey}" stroke="#fffbea" stroke-width="${(0.7 + rand() * 0.8) * s}" opacity="${0.45 + rand() * 0.4}" fill="none"/>`);
  }
  if (scratch) {
    let x = w * (0.1 + rand() * 0.8);
    const y0 = rand() * h * 0.3, y1 = h * (0.6 + rand() * 0.4);
    let d = `M${x} ${y0}`;
    for (let k = 1; k <= 6; k++) d += `L${(x += (rand() - 0.5) * 4 * s)} ${y0 + ((y1 - y0) * k) / 6}`;
    parts.push(`<path d="${d}" stroke="#fffbea" stroke-width="${1.2 * s}" opacity="${0.18 + rand() * 0.17}" fill="none"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join("")}</svg>`;
}

// Credit, bottom-right (the date stamp lives bottom-left). Pre-traced path, so no fonts needed.
// Tone flips with the background (dark text on bright corners, light on dark) and a soft halo in the
// opposite tone keeps it readable over busy detail.
type Box = { x: number; y: number; w: number; h: number };
function watermarkBox(w: number, h: number): Box {
  const textH = Math.min(w, h) * 0.03, pad = Math.min(w, h) * 0.035;
  const textW = (textH * WATERMARK.width) / WATERMARK.height;
  return { x: w - pad - textW, y: h - pad - textH, w: textW, h: textH };
}

function meanLuma(rgb: Buffer, w: number, b: Box): number {
  let sum = 0, n = 0;
  for (let y = Math.floor(b.y); y < Math.ceil(b.y + b.h); y++)
    for (let x = Math.floor(b.x); x < Math.ceil(b.x + b.w); x++) {
      const i = (y * w + x) * 3;
      sum += 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
      n++;
    }
  return n ? sum / n / 255 : 0;
}

function watermarkSvg(w: number, h: number, b: Box, brightBehind: boolean): string {
  const k = b.h / WATERMARK.height;
  const t = `translate(${b.x} ${b.y}) scale(${k})`;
  const [ink, halo] = brightBehind ? ["#16180f", "#fffbea"] : ["#fffbea", "#0b0c08"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><filter id="s"><feGaussianBlur stdDeviation="${b.h * 0.06 / k}"/></filter></defs>
  <path d="${WATERMARK.d}" transform="${t}" fill="${halo}" stroke="${halo}" stroke-width="${b.h * 0.14 / k}" stroke-linejoin="round" opacity="0.45" filter="url(#s)"/>
  <path d="${WATERMARK.d}" transform="${t}" fill="${ink}" opacity="0.68"/>
</svg>`;
}

// Seven-segment LED digits drawn as SVG rects, so no fonts are needed on the server.
const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
  "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

function dateStampSvg(date: Date, w: number, h: number): string {
  const text = `'${String(date.getFullYear()).slice(2)} ${date.getMonth() + 1} ${date.getDate()}`;
  const H = Math.round(Math.min(w, h) * 0.035), W = H * 0.55, t = H * 0.13, half = H / 2, gap = H * 0.22;
  const seg: Record<string, [number, number, number, number]> = {
    a: [t, 0, W - 2 * t, t], b: [W - t, t, t, half - 1.5 * t], c: [W - t, half + t / 2, t, half - 1.5 * t],
    d: [t, H - t, W - 2 * t, t], e: [0, half + t / 2, t, half - 1.5 * t], f: [0, t, t, half - 1.5 * t],
    g: [t, half - t / 2, W - 2 * t, t],
  };
  let x = 0;
  const rects: string[] = [];
  for (const ch of text) {
    if (ch === "'") { rects.push(`<rect x="${x}" y="0" width="${t}" height="${H * 0.3}"/>`); x += t + gap; continue; }
    if (ch === " ") { x += W * 0.6; continue; }
    for (const s of SEGMENTS[ch]) {
      const [sx, sy, sw, sh] = seg[s];
      rects.push(`<rect x="${x + sx}" y="${sy}" width="${sw}" height="${sh}" rx="${t / 3}"/>`);
    }
    x += W + gap;
  }
  const ox = H * 1.5, oy = h - H * 2.2; // bottom-left: the watermark has bottom-right
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><filter id="glow"><feGaussianBlur stdDeviation="${H * 0.12}"/></filter></defs>
  <g transform="translate(${ox} ${oy}) skewX(-6)" fill="#ff8a2a">
    <g filter="url(#glow)" opacity="0.9">${rects.join("")}</g>
    <g opacity="0.85">${rects.join("")}</g>
  </g></svg>`;
}
