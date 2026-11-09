"use client";

import { useState, type FormEvent } from "react";
import { instagramHandle } from "@/lib/config";

// After the party, for people opening the album from a post or another browser (Instagram's in-app browser doesn't
// share the sign-in from the night): add a name and the same page reloads with the whole album, to look at only
// (no saving: see Sheet's viewOnly).
export default function ViewSignIn({ code, total }: { code: string; total: number }) {
  const [agreed, setAgreed] = useState(false); // "I was there, I'll look": the album is for people from the night
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const ig = String(f.get("instagram") ?? "").trim();
    if (!name) return setErr("Add your name to see the album.");
    if (ig && !instagramHandle(ig)) return setErr("That Instagram handle doesn't look right. Leave it blank if you're not on Instagram.");
    setBusy(true);
    setErr("");
    const res = await fetch("/api/session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventCode: code, name, instagram: ig, consent: true }),
    }).catch(() => null);
    if (res?.ok) return location.reload();
    setBusy(false);
    setErr((await res?.json().catch(() => null))?.error ?? "Couldn't connect. Check your signal and try again.");
  }

  return (
    <form className="view-signin" onSubmit={submit} noValidate>
      <h2>Were you there?</h2>
      <p className="lede">Add your name to see all {total.toLocaleString()} photos from the night.</p>
      <label className="field" htmlFor="view-name">Name
        <input id="view-name" name="name" autoComplete="given-name" required />
      </label>
      <label className="field" htmlFor="view-ig">Instagram (optional)
        <input id="view-ig" name="instagram" placeholder="@yourhandle" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </label>
      <label className="check" htmlFor="view-agree">
        <input id="view-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I was at the party. These are everyone&apos;s photos from the night, so I&apos;ll look, not save or repost.</span>
      </label>
      <p className="err" role="alert">{err}</p>
      <button className="cta" type="submit" disabled={busy || !agreed}>
        <span>{busy ? "Opening…" : agreed ? "See the whole album" : "Tick the box to see it"}</span>
        <span aria-hidden>→</span>
      </button>
      <p className="fine">No app, no password. This phone remembers you.</p>
    </form>
  );
}
