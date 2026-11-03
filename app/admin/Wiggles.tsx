"use client";

import { useEffect, useState } from "react";
import { WIGGLE_ASPECT, WIGGLE_GAP_S, wiggleCrop } from "@/lib/wiggle";
import { leaveWiggle, makeWiggle, setPivot } from "./actions";

export type WFrame = { id: string; thumb: string; name: string; at: string; x: number | null; y: number | null };

// The darkroom's Wiggles tab: shots taken at the same moment on different phones, grouped by you, aligned on the
// subject you tap. The live preview loops the aligned frames; scripts/wiggle.ts renders the matched MP4 and GIF.
export default function Wiggles({ saved, candidates }: { saved: { id: string; frames: WFrame[] }[]; candidates: WFrame[][] }) {
  return (
    <div className="wiggles">
      <p className="lede">
        Shots from two or more phones within {WIGGLE_GAP_S} s of each other. Tick the frames of one subject and make a wiggle,
        then tap the subject on each frame so they line up. Render it with <code>npm run wiggle -- &lt;event&gt;</code>.
      </p>
      {saved.map((g) => <Saved key={g.id} id={g.id} frames={g.frames} />)}
      <h2 className="wg-h">Same moment, different phones</h2>
      {candidates.length === 0 && <p className="fine">None yet. Get a few people to shoot one subject on the count of 3.</p>}
      {candidates.map((c) => (
        <form key={c[0].id} action={makeWiggle} className="wg">
          <div className="wg-row">
            {c.map((f) => (
              <label key={f.id} className="wg-frame pick">
                <input type="checkbox" name="photo" value={f.id} defaultChecked />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.thumb} alt={`By ${f.name}`} loading="lazy" />
                <small>{f.name} · {f.at}</small>
              </label>
            ))}
          </div>
          <button className="ghost" type="submit">Make a wiggle</button>
        </form>
      ))}
    </div>
  );
}

function Saved({ id, frames }: { id: string; frames: WFrame[] }) {
  const [pivots, setPivots] = useState(() => Object.fromEntries(frames.map((f) => [f.id, { x: f.x ?? 0.5, y: f.y ?? 0.5 }])));
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [i, setI] = useState(0);
  const cycle = [...frames.keys(), ...[...frames.keys()].slice(1, -1).reverse()]; // there and back
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % cycle.length), 200);
    return () => clearInterval(t);
  }, [cycle.length]);

  const ready = frames.every((f) => ratios[f.id]);
  const crops = ready ? wiggleCrop(frames.map((f) => ({ ...pivots[f.id], ratio: ratios[f.id] }))) : [];
  const shown = cycle[i] ?? 0, c = crops[shown];
  const tap = (f: WFrame, e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    setPivots((s) => ({ ...s, [f.id]: p }));
    void setPivot(f.id, p.x, p.y);
  };

  return (
    <section className="wg">
      <div className="wg-row">
        <div className="wg-preview" style={{ aspectRatio: WIGGLE_ASPECT }} aria-label="Preview">
          {c && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frames[shown].thumb} alt="" style={{
              width: `${100 / c.width}%`, height: `${100 / c.height}%`,
              left: `${(-c.left / c.width) * 100}%`, top: `${(-c.top / c.height) * 100}%`,
            }} />
          )}
        </div>
        {frames.map((f) => (
          <figure key={f.id} className="wg-frame">
            <div className="wg-tap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.thumb} alt={`By ${f.name}: tap the subject`} onClick={(e) => tap(f, e)}
                onLoad={(e) => { const im = e.currentTarget; setRatios((s) => ({ ...s, [f.id]: im.naturalWidth / im.naturalHeight })); }} />
              <i style={{ left: `${pivots[f.id].x * 100}%`, top: `${pivots[f.id].y * 100}%` }} aria-hidden />
            </div>
            <figcaption>
              {f.name} · {f.at} {f.x === null && pivots[f.id].x === 0.5 && pivots[f.id].y === 0.5 && <b>tap the subject</b>}
              <button type="button" onClick={() => leaveWiggle([f.id])}>Remove</button>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="fine">
        <code>npm run wiggle -- {id.slice(0, 8)}</code> ·{" "}
        <button type="button" className="linkish" onClick={() => leaveWiggle(frames.map((f) => f.id))}>Ungroup</button>
      </p>
    </section>
  );
}
