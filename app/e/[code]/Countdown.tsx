"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

// Pinned to the top of every page of the event: where the night is, and how long until the roll opens.
// The anticipation is the point, so it's always in view.
export default function Countdown({ release, closes, code }: { release: string | null; closes: string | null; code: string }) {
  const [now, setNow] = useState<number | null>(null); // set after mount, so server and phone render the same thing
  const router = useRouter();
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // The host can open (or hide) the album early from the darkroom: pick that up when the guest comes back to the tab,
  // and every 2 minutes while it's open. Only the event's details are re-read; the camera keeps its state.
  useEffect(() => {
    const check = () => document.visibilityState === "visible" && router.refresh();
    const t = setInterval(check, 120_000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, [router]);
  const r = release ? new Date(release).getTime() : null, c = closes ? new Date(closes).getTime() : null;
  if (now === null || (!r && !c)) return null;
  if (r && now < r)
    return <div className="topbar" role="timer"><span>Album opens in</span><b>{clock(r - now)}</b></div>;
  if (r && (!c || now < c))
    return (
      <a className="topbar open" href={`/e/${code}/roll`}>
        <span>The album is open</span><b>See everyone&apos;s shots →</b>
        {c && <small>Shooting until {new Date(c).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>}
      </a>
    );
  if (c && now < c) return <div className="topbar" role="timer"><span>Last call in</span><b>{clock(c - now)}</b></div>;
  return r ? <a className="topbar open" href={`/e/${code}/roll`}><span>That&apos;s a wrap.</span><b>See the album →</b></a> : null;
}
