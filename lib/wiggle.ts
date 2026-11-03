// Wigglegrams: several guests shoot one subject at the same moment from different spots; the frames played back and
// forth (0.2 s each) look like a frozen moment you can walk around. Shared by the darkroom (find + align) and
// scripts/wiggle.ts (render).

// Within this many seconds of the previous shot counts as "the same moment" (phones' clocks are corrected on upload;
// a phone with the flash on waits up to 1.5 s for its light, so a count of 3 lands within about this).
export const WIGGLE_GAP_S = 3;
export const WIGGLE_ASPECT = 4 / 5; // Instagram's tallest feed shape

type Shot = { id: string; at: Date | null; phone: string };

// Bursts of shots from at least two different phones, each shot within WIGGLE_GAP_S of the one before.
// ponytail: time only; the host's eye confirms it's one subject. Add image matching if parties get big enough to swamp it.
export function wiggleCandidates<T extends Shot>(shots: T[]): T[][] {
  const timed = shots.filter((s) => s.at).sort((a, b) => +a.at! - +b.at!);
  const groups: T[][] = [];
  for (const s of timed) {
    const g = groups.at(-1);
    if (g && +s.at! - +g.at(-1)!.at! <= WIGGLE_GAP_S * 1000) g.push(s);
    else groups.push([s]);
  }
  return groups.filter((g) => new Set(g.map((s) => s.phone)).size >= 2);
}

// The crop that keeps every frame's pivot (the subject, as fractions of the frame) dead centre, as big as the
// tightest frame allows. Frames are scaled to the same height; `ratio` is width / height.
// Returns each frame's crop as fractions of its own width and height.
export type Pivot = { x: number; y: number; ratio: number };
export function wiggleCrop(frames: Pivot[]): { left: number; top: number; width: number; height: number }[] {
  // half the crop's height, in units of frame height
  const half = Math.min(...frames.map((f) => Math.min(f.y, 1 - f.y, (f.x * f.ratio) / WIGGLE_ASPECT, ((1 - f.x) * f.ratio) / WIGGLE_ASPECT)));
  return frames.map((f) => ({
    left: f.x - (half * WIGGLE_ASPECT) / f.ratio,
    top: f.y - half,
    width: (2 * half * WIGGLE_ASPECT) / f.ratio,
    height: 2 * half,
  }));
}
