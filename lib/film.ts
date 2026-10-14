import sharp, { type OverlayOptions } from "sharp";
import convert from "heic-convert";

type RGB = [number, number, number];

export type FilmOptions = {
  maxEdge: number; // output long edge in px (disposable scans are ~2000)
  exposure: number; // global gain before the film curve
  flash: {
    mode: "depth" | "center" | "off"; // depth: closest things get the flash. center: radial falloff. off: plain filter
    near: number; // gain on the nearest subject
    far: number; // gain on the background
    falloff: number; // >1 = flash dies off faster with distance (depth mode)
    radius: number; // center mode only, fraction of long edge
    centerY: number; // center mode only
    auto: [number, number]; // scene mean brightness: >= [0] no flash look (daylight), <= [1] full flash look
  };
  vignette: number; // 0..1 corner darkening
  lightThreshold: number; // source brightness above which a pixel counts as a light (ignores flash falloff)
  halation: { strength: number; threshold: number; radius: number; color: RGB }; // radius = fraction of long edge
  shoulder: number; // where highlights start rolling off (0..1)
  contrast: number; // S-curve strength 0..1
  blackPoint: RGB; // milky, tinted blacks (0..1 per channel)
  shadowTint: RGB; // per-channel multiplier, fades in toward the shadows
  whitePoint: RGB; // creamy, capped whites
  saturation: number;
  warmSaturation: number; // saturation for warm colours (skin), so cool colours can fade while skin stays rich
  warmth: number; // pushes red up / blue down in lit areas (skin)
  grain: { amount: number; size: number; shadowBoost: number; chroma: number };
  softness: number; // final blur sigma in px, 0 = off
  leak: { chance: number; strength: number }; // orange/red light leak from the film edge
  dust: number; // dust specks and hairs, 0 = clean scan
  scratches: number; // chance of a long scratch
  dateStamp: Date | null; // orange LED date in the corner
  seed: number; // same seed = same grain, leaks and dust. Use a per-photo value
  quality: number; // jpeg quality
};

// Tuned against night-time disposable flash shots: olive-brown blacks, warm skin,
// creamy blown centre, heavy grain, red glow around lights.
export const DEFAULT_FILM: FilmOptions = {
  maxEdge: 2000,
  exposure: 1.0,
  flash: { mode: "depth", near: 1.6, far: 0.62, falloff: 1.3, radius: 0.28, centerY: 0.5, auto: [0.7, 0.55] },
  vignette: 0.3,
  lightThreshold: 0.97,
  halation: { strength: 0.7, threshold: 0.82, radius: 0.012, color: [1, 0.32, 0.12] },
  shoulder: 0.72,
  contrast: 0.75,
  blackPoint: [0.08, 0.08, 0.03],
  shadowTint: [0.97, 1.0, 0.72],
  whitePoint: [0.97, 0.95, 0.86],
  saturation: 1.12,
  warmSaturation: 1.12,
  warmth: 0.35,
  grain: { amount: 0.075, size: 1.6, shadowBoost: 1.2, chroma: 0.35 },
  softness: 0.8,
  leak: { chance: 0.35, strength: 0.55 },
  dust: 1,
  scratches: 0.3,
  dateStamp: null,
  seed: 1,
  quality: 86,
};

// Named looks, applied on top of DEFAULT_FILM.
export const PRESETS: Record<string, Partial<FilmOptions>> = {
  // Instagram-style "dirty flash" as a plain grade: no subject detection, just cool faded colour,
  // rich skin, dark edges, dust.
  dirtyFlash: {
    flash: { mode: "off", near: 1, far: 1, falloff: 1, radius: 0.28, centerY: 0.5, auto: [0.7, 0.55] },
    contrast: 0.8,
    saturation: 0.7,
    warmSaturation: 1.25,
    warmth: 0.45,
    blackPoint: [0.05, 0.07, 0.09],
    shadowTint: [0.82, 1.0, 1.12],
    whitePoint: [0.97, 0.97, 0.94],
    grain: { amount: 0.06, size: 1.3, shadowBoost: 1.0, chroma: 0.3 },
    halation: { strength: 0.4, threshold: 0.85, radius: 0.012, color: [1, 0.35, 0.15] },
    vignette: 0.55,
    dust: 1.6,
  },
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

  // Daylight shots shouldn't get the night flash look: scale it by how dark the scene is.
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  const [dayAt, nightAt] = o.flash.auto;
  const night = clamp01((dayAt - sum / n / 255) / (dayAt - nightAt));
  const near = night > 0 && o.flash.mode === "depth" ? await nearness(data, w, h) : null;
  const flashOn = night > 0 && o.flash.mode !== "off";

  // Pass 1, optics: flash falloff + vignette on the scene, and a mask of bright spots for halation.
  const scene = new Float32Array(n * 3);
  const bright = Buffer.alloc(n);
  const { near: fNear, far: fFar } = o.flash;
  const cx = w / 2, cy = h * o.flash.centerY;
  const r2 = 2 * (o.flash.radius * long) ** 2;
  const halfDiag2 = (w / 2) ** 2 + (h / 2) ** 2;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const reach = near ? near[i] ** o.flash.falloff : Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / r2);
      const flash = flashOn ? 1 + (fFar + (fNear - fFar) * reach - 1) * night : 1;
      const vd = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / halfDiag2;
      const sr = data[i * 3] / 255, sg = data[i * 3 + 1] / 255, sb = data[i * 3 + 2] / 255;
      const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
      // lights in the frame are emitters, not lit by the flash: keep them bright
      const emit = lum < o.lightThreshold ? 0 : (lum - o.lightThreshold) / (1 - o.lightThreshold);
      const gain = (o.exposure * flash + (1 - o.exposure * flash) * emit) * (1 - o.vignette * vd * vd);
      scene[i * 3] = sr * gain; scene[i * 3 + 1] = sg * gain; scene[i * 3 + 2] = sb * gain;
      bright[i] = lum > o.halation.threshold ? Math.min(255, ((lum - o.halation.threshold) / (1 - o.halation.threshold)) * 255) : 0;
    }
  }

  const sigma = Math.max(0.3, o.halation.radius * long);
  const [glow, noise] = await Promise.all([
    o.halation.strength > 0
      ? sharp(bright, { raw: { width: w, height: h, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer() // sharp outputs 3 channels otherwise
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
    const sat = o.saturation + (o.warmSaturation - o.saturation) * clamp01((r - b) * 3);
    r = lum + (r - lum) * sat;
    g = lum + (g - lum) * sat;
    b = lum + (b - lum) * sat;
    // flash light is warm; keep the warmth on the lit areas so shadows can carry their own tint
    r *= 1 + 0.1 * o.warmth * lum;
    b *= 1 - 0.18 * o.warmth * lum;
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

  // Soften first as its own step so dust and the stamp composited on top stay crisp.
  const raw = { raw: { width: w, height: h, channels: 3 as const } };
  const base = o.softness >= 0.3 ? await sharp(out, raw).blur(o.softness).raw().toBuffer() : out;
  const rand = mulberry32(o.seed ^ 0x9e3779b9);
  const layers: OverlayOptions[] = [];
  if (rand() < o.leak.chance) layers.push({ input: Buffer.from(leakSvg(w, h, rand, o.leak.strength)), blend: "screen" });
  if (o.dust > 0 || o.scratches > 0) layers.push({ input: Buffer.from(dustSvg(w, h, rand, o.dust, rand() < o.scratches)) });
  if (o.dateStamp) layers.push({ input: Buffer.from(dateStampSvg(o.dateStamp, w, h)) });
  return sharp(base, raw).composite(layers).jpeg({ quality: o.quality, mozjpeg: true }).toBuffer(); // sharp drops EXIF (incl. GPS)
}

type DepthFn = (img: unknown) => Promise<{ depth: { data: Uint8Array; width: number; height: number } }>;
let depthModel: Promise<{ est: DepthFn; RawImage: typeof import("@huggingface/transformers").RawImage }> | undefined;

// How close each pixel is to the camera, 0 (far) to 1 (near), from Depth Anything V2 Small
// (Apache-2.0, ~25MB, downloaded on first use and cached). ~150ms per photo on a laptop CPU.
async function nearness(data: Buffer, w: number, h: number): Promise<Float32Array> {
  depthModel ??= import("@huggingface/transformers").then(async (t) => {
    const pipeline = t.pipeline as unknown as (task: string, model: string, opts: object) => Promise<DepthFn>;
    return { est: await pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8" }), RawImage: t.RawImage };
  });
  const { est, RawImage } = await depthModel;
  const small = await sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .resize(518, 518, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { depth } = await est(new RawImage(new Uint8ClampedArray(small.data), small.info.width, small.info.height, 3));
  const full = await sharp(Buffer.from(depth.data), { raw: { width: depth.width, height: depth.height, channels: 1 } })
    .resize(w, h, { fit: "fill" })
    .extractChannel(0) // sharp outputs 3 channels otherwise
    .raw()
    .toBuffer();
  if (full.length !== w * h) throw new Error(`depth map is ${full.length} bytes, expected ${w * h}`);
  // Split subject from background (Otsu threshold on the depth histogram): the whole subject gets the
  // flash, the background falls off. A little of the continuous depth keeps some gradient within each.
  const hist = new Uint32Array(256);
  for (const v of full) hist[v]++;
  const pct = (p: number) => {
    for (let v = 0, acc = 0; v < 256; v++) if ((acc += hist[v]) >= p * full.length) return v;
    return 255;
  };
  const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.99));
  const t = otsu(hist, full.length), band = Math.max(4, (hi - lo) * 0.12);
  const out = new Float32Array(full.length);
  for (let i = 0; i < full.length; i++) {
    const subject = clamp01((full[i] - (t - band)) / (2 * band));
    out[i] = 0.8 * subject * subject * (3 - 2 * subject) + 0.2 * clamp01((full[i] - lo) / (hi - lo));
  }
  return out;
}

function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; t = v; }
  }
  return t;
}

// Soft orange/red blobs bleeding in from one film edge, composited with "screen".
function leakSvg(w: number, h: number, rand: () => number, strength: number): string {
  const colors = ["#ff2a00", "#ff6a00", "#ffa600", "#ff1f4b"];
  const edge = rand() < 0.5 ? 0 : w;
  const blobs = Array.from({ length: 2 + Math.floor(rand() * 2) }, (_, i) => {
    const c = colors[Math.floor(rand() * colors.length)];
    const cx = edge === 0 ? rand() * w * 0.08 : w - rand() * w * 0.08;
    return `<radialGradient id="l${i}"><stop offset="0" stop-color="${c}" stop-opacity="${strength * (0.6 + rand() * 0.4)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
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
    const fill = c < 0.65 ? "#fffbea" : c < 0.85 ? "#ff9a5a" : "#1a1a12"; // mostly white, some orange, a few dark
    parts.push(`<ellipse cx="${rand() * w}" cy="${rand() * h}" rx="${(0.6 + rand() * 2.2) * s}" ry="${(0.5 + rand() * 1.6) * s}" fill="${fill}" opacity="${0.35 + rand() * 0.5}"/>`);
  }
  for (let i = 0, hairs = Math.round(amount * rand() * 3); i < hairs; i++) {
    const x = rand() * w, y = rand() * h, len = (40 + rand() * 160) * s, a = rand() * Math.PI * 2;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const qx = (x + ex) / 2 + (rand() - 0.5) * len, qy = (y + ey) / 2 + (rand() - 0.5) * len;
    parts.push(`<path d="M${x} ${y}Q${qx} ${qy} ${ex} ${ey}" stroke="#fffbea" stroke-width="${(0.8 + rand() * 0.8) * s}" opacity="${0.4 + rand() * 0.35}" fill="none"/>`);
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
