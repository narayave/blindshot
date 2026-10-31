"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Frame = { id: string; thumb: string; src: string; by: string; n: number; star: boolean };

export default function Sheet({ frames, moreHref, empty, name }: { frames: Frame[]; moreHref: string | null; empty: string; name: string }) {
  const [start, setStart] = useState<number | null>(null); // the frame tapped to open the viewer
  const [cur, setCur] = useState(0); // the frame on screen now
  const [file, setFile] = useState<File | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const open = start !== null;
  const frame = open ? frames[cur] : null;

  // Land on the tapped frame, then let the guest swipe (scroll-snap does the swiping).
  useLayoutEffect(() => {
    if (start === null || !track.current) return;
    track.current.scrollLeft = start * track.current.clientWidth;
    setCur(start);
  }, [start]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStart(null);
      const t = track.current;
      if (t && (e.key === "ArrowRight" || e.key === "ArrowLeft")) t.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * t.clientWidth, behavior: "smooth" });
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, []);
  // Fetch the frame on screen right away: phones only allow the share sheet straight from the tap, with no waiting.
  useEffect(() => {
    setFile(null);
    if (!frame) return;
    let live = true;
    fetch(frame.src)
      .then((r) => r.blob())
      .then((b) => live && setFile(new File([b], `${name}-${frame.by.toLowerCase().replace(/\W+/g, "")}-${frame.n}.jpg`, { type: "image/jpeg" })))
      .catch(() => {});
    return () => { live = false; };
  }, [frame, name]);

  // Phones: the share sheet, where "Save Image" puts it in the camera roll. Elsewhere: a plain download.
  function save() {
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) return void navigator.share({ files: [file] }).catch(() => {});
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  return (
    <>
      <div className="sheet">
        {frames.length === 0 && <p className="empty">{empty}</p>}
        {frames.map((f, i) => (
          <button key={f.id} className="frame" type="button" onClick={() => setStart(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.thumb} alt={`Frame ${f.n} by ${f.by}`} loading="lazy" decoding="async" />
            <span className="edge"><span>{f.by}</span><span>▸ {f.n}</span></span>
            {f.star && <span className="star" title="Host pick">★</span>}
          </button>
        ))}
        {moreHref && <a className="more" href={moreHref}>Show more frames</a>}
      </div>
      {open && frame && (
        <div className="lightbox" role="dialog" aria-label="Photos">
          <div
            className="lb-track"
            ref={track}
            onScroll={(e) => {
              const t = e.currentTarget, i = Math.round(t.scrollLeft / t.clientWidth);
              if (i !== cur && i >= 0 && i < frames.length) setCur(i);
            }}
          >
            {frames.map((f, i) => (
              <figure key={f.id} className="lb-slide">
                {/* only the frames next to the one on screen load at full size */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={Math.abs(i - cur) <= 2 ? f.src : f.thumb} alt={`Frame ${f.n} by ${f.by}`} draggable={false} />
                <figcaption>Shot by {f.by} · frame {f.n}{f.star ? " · host pick" : ""}</figcaption>
              </figure>
            ))}
          </div>
          <p className="lb-count" aria-live="polite">{cur + 1} / {frames.length}{frames.length > 1 ? " · swipe for more" : ""}</p>
          <div className="lb-bar">
            <button type="button" onClick={save} disabled={!file}>{file ? "Save photo" : "Getting photo…"}</button>
            <a href={frame.src} target="_blank" rel="noreferrer">Open full size</a>
            <button type="button" onClick={() => setStart(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
