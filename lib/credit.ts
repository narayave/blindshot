// A photo's credit (the guest's @handle or first name) as SVG path data, traced from Special Elite at develop time,
// so the worker needs no fonts installed. Font: Apache 2.0, lib/fonts/LICENSE-SpecialElite.txt.
import { readFileSync } from "node:fs";
import opentype from "opentype.js";

const SIZE = 100;
let font: opentype.Font | undefined;
const traced = new Map<string, Credit>();
export type Credit = { text: string; width: number; height: number; d: string };

export function creditPath(text: string): Credit | null {
  const hit = traced.get(text);
  if (hit) return hit;
  if (!font) {
    const buf = readFileSync(new URL("./fonts/SpecialElite-Regular.ttf", import.meta.url));
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  // Characters the font doesn't have (emoji, some accents) are left out rather than drawn as boxes.
  const glyphs = [...text].map((ch) => font!.charToGlyph(ch)).filter((g) => g.index !== 0);
  if (!glyphs.length) return null;
  // Lay glyphs out by hand (advance + kerning): opentype.js's shaper and toPathData both trip on this font.
  const layout = (ox: number, oy: number) => {
    const path = new opentype.Path();
    let x = ox;
    glyphs.forEach((g, i) => {
      for (const c of g.getPath(0, 0, SIZE).commands) {
        const m = c as Record<string, unknown>;
        for (const k of ["x", "x1", "x2"]) if (typeof m[k] === "number") m[k] = (m[k] as number) + x;
        for (const k of ["y", "y1", "y2"]) if (typeof m[k] === "number") m[k] = (m[k] as number) + oy;
        path.commands.push(c);
      }
      const kern = glyphs[i + 1] ? font!.getKerningValue(g, glyphs[i + 1]) : 0;
      x += ((g.advanceWidth || 0) + (Number.isFinite(kern) ? kern : 0)) * (SIZE / font!.unitsPerEm);
    });
    return path;
  };
  const box = layout(0, 0).getBoundingBox();
  const n = (v: number) => +v.toFixed(1);
  const d = layout(-box.x1, -box.y1).commands.map((c) => {
    const m = c as unknown as Record<string, number>;
    if (c.type === "M" || c.type === "L") return `${c.type}${n(m.x)} ${n(m.y)}`;
    if (c.type === "Q") return `Q${n(m.x1)} ${n(m.y1)} ${n(m.x)} ${n(m.y)}`;
    if (c.type === "C") return `C${n(m.x1)} ${n(m.y1)} ${n(m.x2)} ${n(m.y2)} ${n(m.x)} ${n(m.y)}`;
    return "Z";
  }).join("");
  if (d.includes("NaN")) return null;
  const credit = { text, width: Math.max(1, box.x2 - box.x1), height: Math.max(1, box.y2 - box.y1), d };
  traced.set(text, credit);
  return credit;
}
