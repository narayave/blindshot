"use client";

import { useEffect, useState } from "react";

type Frame = { id: string; thumb: string; src: string; by: string; n: number; star: boolean };

export default function Sheet({ frames, moreHref, empty, name }: { frames: Frame[]; moreHref: string | null; empty: string; name: string }) {
  const [open, setOpen] = useState<Frame | null>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);
  // Fetch the frame as soon as it opens: phones only allow the share sheet straight from the tap, with no waiting.
  useEffect(() => {
    setFile(null);
    if (!open) return;
    let live = true;
    fetch(open.src)
      .then((r) => r.blob())
      .then((b) => live && setFile(new File([b], `${name}-${open.by.toLowerCase().replace(/\W+/g, "")}-${open.n}.jpg`, { type: "image/jpeg" })))
      .catch(() => {});
    return () => { live = false; };
  }, [open, name]);

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
        {frames.map((f) => (
          <button key={f.id} className="frame" type="button" onClick={() => setOpen(f)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.thumb} alt={`Frame ${f.n} by ${f.by}`} loading="lazy" decoding="async" />
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
            <button type="button" onClick={save} disabled={!file}>{file ? "Save photo" : "Getting photo…"}</button>
            <a href={open.src} target="_blank" rel="noreferrer">Open full size</a>
            <button type="button" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
