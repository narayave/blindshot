"use client";

import { useEffect, useState } from "react";

type Frame = { id: string; src: string; by: string; n: number; star: boolean };

export default function Sheet({ frames, moreHref, empty }: { frames: Frame[]; moreHref: string | null; empty: string }) {
  const [open, setOpen] = useState<Frame | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  return (
    <>
      <div className="sheet">
        {frames.length === 0 && <p className="empty">{empty}</p>}
        {frames.map((f) => (
          <button key={f.id} className="frame" type="button" onClick={() => setOpen(f)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.src} alt={`Frame ${f.n} by ${f.by}`} loading="lazy" />
            <span className="edge"><span>{f.by}</span><span>▸ {f.n}</span></span>
            {f.star && <span className="star" title="Host pick">★</span>}
          </button>
        ))}
        {moreHref && <a className="more" href={moreHref}>Show more frames</a>}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-label={`Frame ${open.n} by ${open.by}`} onClick={() => setOpen(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.src} alt={`Frame ${open.n} by ${open.by}`} />
          <p>Shot by {open.by} · frame {open.n}{open.star ? " · host pick" : ""}</p>
          <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
            <a href={open.src} target="_blank" rel="noreferrer">Open full size</a>
            <button type="button" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
