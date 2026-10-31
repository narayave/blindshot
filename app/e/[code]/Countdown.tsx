"use client";

import { useEffect, useState } from "react";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

// Pinned to the top of every page of the event: where the night is, and how long until the roll opens.
// The anticipation is the point, so it's always in view.
export default function Countdown({ release, closes, code }: { release: string | null; closes: string | null; code: string }) {
  const [now, setNow] = useState<number | null>(null); // set after mount, so server and phone render the same thing
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const r = release ? new Date(release).getTime() : null, c = closes ? new Date(closes).getTime() : null;
  if (now === null || (!r && !c)) return null;
  if (r && now < r)
    return <div className="topbar" role="timer"><span>Roll opens in</span><b>{clock(r - now)}</b></div>;
  if (r && (!c || now < c))
    return (
      <a className="topbar open" href={`/e/${code}/roll`}>
        <span>The roll is open</span><b>See everyone&apos;s shots →</b>
        {c && <small>Shooting until {new Date(c).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>}
      </a>
    );
  if (c && now < c) return <div className="topbar" role="timer"><span>Last call in</span><b>{clock(c - now)}</b></div>;
  return r ? <a className="topbar open" href={`/e/${code}/roll`}><span>That&apos;s a wrap.</span><b>See the roll →</b></a> : null;
}
