"use client";

import { useEffect, useState } from "react";

// "The roll opens in 1:23:45", ticking; at zero it becomes the way in. The anticipation is part of the night.
export default function Countdown({ to, code }: { to: string; code: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = new Date(to).getTime() - now;
  if (left <= 0) return <a className="countdown open" href={`/e/${code}/roll`}>The roll is open. See everyone&apos;s shots →</a>;
  const s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const clock = `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return <p className="countdown" role="timer" suppressHydrationWarning>The roll opens in <b suppressHydrationWarning>{clock}</b></p>;
}
