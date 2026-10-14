import sharp from "sharp";
import convert from "heic-convert";

type RGB = [number, number, number];

export type FilmOptions = {
  maxEdge: number; // output long edge in px (disposable scans are ~2000)
  exposure: number; // global gain before the film curve
  flash: { center: number; edge: number; radius: number; centerY: number }; // on-camera flash falloff
  vignette: number; // 0..1 corner darkening
  halation: { strength: number; threshold: number; radius: number; color: RGB }; // radius = fraction of long edge
  shoulder: number; // where highlights start rolling off (0..1)
  contrast: number; // S-curve strength 0..1
  blackPoint: RGB; // milky, tinted blacks (0..1 per channel)
  shadowTint: RGB; // per-channel multiplier, fades in toward the shadows
  whitePoint: RGB; // creamy, capped whites
  saturation: number;
  warmth: number; // pushes red up / blue down (skin)
  grain: { amount: number; size: number; shadowBoost: number; chroma: number };
  softness: number; // final blur sigma in px, 0 = off
  dateStamp: Date | null; // orange LED date in the corner
  seed: number; // same seed = same grain
  quality: number; // jpeg quality
};

// Tuned against night-time disposable flash shots: olive-brown blacks, warm skin,
// creamy blown centre, heavy grain, red glow around lights.
export const DEFAULT_FILM: FilmOptions = {
  maxEdge: 2000,
  exposure: 1.0,
  flash: { center: 1.5, edge: 0.4, radius: 0.3, centerY: 0.5 },
  vignette: 0.35,
  halation: { strength: 0.7, threshold: 0.82, radius: 0.012, color: [1, 0.32, 0.12] },
  shoulder: 0.72,
  contrast: 0.75,
  blackPoint: [0.065, 0.068, 0.02],
  shadowTint: [0.97, 1.0, 0.72],
  whitePoint: [0.97, 0.95, 0.86],
  saturation: 1.12,
  warmth: 0.35,
  grain: { amount: 0.075, size: 1.6, shadowBoost: 1.2, chroma: 0.35 },
  softness: 0.8,
  dateStamp: null,
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
  const src = isHeic(input) ? Buffer.from(await convert({ buffer: input, format: "JPEG", quality: 0.95 })) : input;

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

  // Pass 1, optics: flash falloff + vignette on the scene, and a mask of bright spots for halation.
  const scene = new Float32Array(n * 3);
  const bright = Buffer.alloc(n);
  const cx = w / 2, cy = h * o.flash.centerY;
  const r2 = 2 * (o.flash.radius * long) ** 2;
  const halfDiag2 = (w / 2) ** 2 + (h / 2) ** 2;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      const flash = o.flash.edge + (o.flash.center - o.flash.edge) * Math.exp(-d2 / r2);
      const vd = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / halfDiag2;
      const sr = data[i * 3] / 255, sg = data[i * 3 + 1] / 255, sb = data[i * 3 + 2] / 255;
      const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
      // lights in the frame are emitters, not lit by the flash: keep them bright
      const emit = lum < 0.8 ? 0 : (lum - 0.8) / 0.2;
      const gain = (o.exposure * flash + (1 - o.exposure * flash) * emit) * (1 - o.vignette * vd * vd);
      scene[i * 3] = sr * gain; scene[i * 3 + 1] = sg * gain; scene[i * 3 + 2] = sb * gain;
      bright[i] = lum > o.halation.threshold ? Math.min(255, ((lum - o.halation.threshold) / (1 - o.halation.threshold)) * 255) : 0;
    }
  }

  const sigma = Math.max(0.3, o.halation.radius * long);
  const [glow, noise] = await Promise.all([
    o.halation.strength > 0
      ? sharp(bright, { raw: { width: w, height: h, channels: 1 } }).blur(sigma).raw().toBuffer()
      : null,
    grainNoise(w, h, o.grain.size, o.seed),
  ]);

  // Pass 2, film: halation, highlight shoulder, S-curve, colour, black/white points, grain.
  const out = Buffer.alloc(n * 3);
  const k = o.shoulder;
  const hc = o.halation.color;
  for (let i = 0; i < n; i++) {
    const halo = glow ? (glow[i] / 255) * o.halation.strength : 0;
    let r = scene[i * 3] + halo * hc[0];
    let g = scene[i * 3 + 1] + halo * hc[1];
    let b = scene[i * 3 + 2] + halo * hc[2];

    // soft highlight roll-off so the flash-blown centre goes creamy, not digital-clipped
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

  let img = sharp(out, { raw: { width: w, height: h, channels: 3 } });
  if (o.softness >= 0.3) img = img.blur(o.softness);
  if (o.dateStamp) {
    // blur and composite run in a fixed order inside one pipeline; flatten first so the stamp stays crisp
    img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(dateStampSvg(o.dateStamp, w, h)) }]);
  }
  return img.jpeg({ quality: o.quality, mozjpeg: true }).toBuffer(); // sharp drops EXIF (incl. GPS) by default
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
  const ox = w - x - H * 1.5, oy = h - H * 2.2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><filter id="glow"><feGaussianBlur stdDeviation="${H * 0.12}"/></filter></defs>
  <g transform="translate(${ox} ${oy}) skewX(-6)" fill="#ff8a2a">
    <g filter="url(#glow)" opacity="0.9">${rects.join("")}</g>
    <g opacity="0.85">${rects.join("")}</g>
  </g></svg>`;
}
