"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type EventInfo = {
  code: string;
  name: string;
  subtitle: string | null;
  maxShots: number;
  allowOptOuts: boolean;
  releaseAt: string | null;
  released: boolean;
  chip: string;
  decor: boolean;
};
type Guest = { name: string; shotsUsed: number };

export default function CameraApp({ event, guest }: { event: EventInfo; guest: Guest | null }) {
  const [me, setMe] = useState(guest);
  return (
    <div className="app">
      <header className="top">
        <a className="wordmark" href="/">blindshot</a>
        <div className="event">
          <b>{event.name}</b>
          {event.subtitle && <><br />{event.subtitle}</>}
        </div>
      </header>
      {me ? <Camera event={event} me={me} /> : <Join event={event} onJoined={setMe} />}
    </div>
  );
}

/* ---------------- join ---------------- */

function Join({ event, onJoined }: { event: EventInfo; onJoined: (g: Guest) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const email = String(f.get("email") ?? "").trim();
    if (!name) return setErr("Add your first name so your frames are credited to you.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("That email doesn't look right. We need it to get you back into the roll.");
    if (f.get("consent") !== "on") return setErr("Tick the box to agree to how photos are shared.");
    setErr("");
    setBusy(true);
    unlockAudio();
    const res = await postJSON("/api/session", {
      eventCode: event.code,
      name,
      email,
      consent: true,
      noPromo: f.get("noPromo") === "on",
      privateRoll: f.get("privateRoll") === "on",
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setErr((await res?.json().catch(() => null))?.error ?? "Couldn't connect. Check your signal and try again.");
    onJoined(await res.json());
  }

  return (
    <section className="stack">
      <h1 className="headline">
        {event.maxShots} shots.<br /><em>No peeking.</em>
      </h1>
      <p className="lede">Shoot the night like a disposable. Nobody sees a frame until the party&apos;s roll develops, then everyone sees everything.</p>
      {event.decor ? <div className="toran" aria-hidden /> : <div className="stripes" aria-hidden><i /><i /><i /></div>}
      <form onSubmit={submit} noValidate>
        <label className="field" htmlFor="name">First name
          <input id="name" name="name" autoComplete="given-name" required />
        </label>
        <label className="field" htmlFor="email">Email, to get back into the roll later
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required />
        </label>
        <div className="consent">
          <label className="check" htmlFor="consent">
            <input id="consent" name="consent" type="checkbox" />
            <span>
              My photos are saved, seen by the host, and go into the party&apos;s shared roll. The host may post them
              {event.allowOptOuts ? ", unless I opt out below." : "."}
            </span>
          </label>
          {event.allowOptOuts && (
            <>
              <label className="check opt" htmlFor="noPromo">
                <input id="noPromo" name="noPromo" type="checkbox" />
                <span>Don&apos;t use my photos for promotion</span>
              </label>
              <label className="check opt" htmlFor="privateRoll">
                <input id="privateRoll" name="privateRoll" type="checkbox" />
                <span>Keep my photos out of the shared roll. Only the host sees them.</span>
              </label>
            </>
          )}
        </div>
        <p className="err" role="alert">{err}</p>
        <button className="cta" type="submit" disabled={busy}>
          <span>{busy ? "Loading film…" : "Load film"}</span>
          <span aria-hidden>→</span>
        </button>
        <p className="fine">No password. This phone remembers you for the night.</p>
      </form>
    </section>
  );
}

/* ---------------- camera ---------------- */

const WIND_PX = 120;

function Camera({ event, me }: { event: EventInfo; me: Guest }) {
  const [left, setLeft] = useState(event.maxShots - me.shotsUsed);
  const [wound, setWound] = useState(true);
  const [flash, setFlash] = useState(true);
  const [charged, setCharged] = useState(true);
  const [cam, setCam] = useState<"starting" | "live" | "off">("starting");
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<[string, string]>([`Ready, ${me.name}`, "Frame it in the little window. That's all you get."]);
  const [nudge, setNudge] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLButtonElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const windRef = useRef({ acc: 0, pos: 0, lastX: null as number | null, moved: 0 });

  async function startCamera() {
    setCam("starting");
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCam("live");
    } catch {
      setCam("off");
    }
  }
  const stopCamera = () => streamRef.current?.getTracks().forEach((t) => t.stop());

  useEffect(() => {
    if (left > 0) startCamera();
    // phones kill the camera when you switch apps; bring it back when the page is visible again
    const onVisible = () => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (document.visibilityState === "visible" && (!track || track.readyState === "ended")) startCamera();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stopCamera();
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (left === 0) stopCamera();
  }, [left]);

  // Don't let people close the page with shots still uploading.
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  function charge() {
    setCharged(false);
    whine();
    setTimeout(() => setCharged(true), 1500);
  }

  function toggleFlash() {
    const on = !flash;
    setFlash(on);
    if (on) charge();
  }

  function addWind(px: number) {
    if (wound || left === 0) return;
    const w = windRef.current;
    w.pos -= px;
    if (wheelRef.current) wheelRef.current.style.backgroundPositionX = `${w.pos}px`;
    const before = Math.floor(w.acc / 12);
    w.acc += px;
    if (Math.floor(w.acc / 12) > before) { tick(); buzz(4); }
    if (w.acc >= WIND_PX) {
      w.acc = 0;
      setWound(true);
      setStatus(["Ready", `${left} shot${left === 1 ? "" : "s"} left`]);
      buzz(20);
    }
  }

  function flashFx(fired: boolean) {
    const fx = fxRef.current;
    if (!fx || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    fx.className = "flashfx" + (fired ? "" : " dark");
    void fx.offsetWidth;
    fx.classList.add("go");
  }

  async function grab(): Promise<{ blob: Blob; w: number; h: number }> {
    const v = videoRef.current!;
    const track = streamRef.current?.getVideoTracks()[0];
    // Real flash where the browser allows it (Android Chrome); iPhones get the screen flash only.
    const torch = flash && charged && !!track && !!(track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
    if (torch) {
      await track!.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {});
      await sleep(250);
    }
    try {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("capture failed"))), "image/jpeg", 0.92));
      return { blob, w: c.width, h: c.height };
    } finally {
      if (torch) track!.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
    }
  }

  async function shoot(file?: File) {
    if (left <= 0 || busy.current) return;
    if (!wound) {
      setNudge((n) => n + 1);
      setStatus(["Wind the film first", "Drag the wheel sideways, or tap it a few times."]);
      buzz([10, 40, 10]);
      return;
    }
    if (!file && cam !== "live") return;
    busy.current = true;
    const fired = flash && charged;
    click();
    buzz(18);
    flashFx(fired);
    try {
      const shot = file ? { blob: file as Blob, w: 0, h: 0 } : await grab();
      setWound(false);
      setLeft((l) => l - 1);
      setStatus(left - 1 === 0 ? ["That's the roll", "Developing…"] : ["Saved", "Wind on for the next shot."]);
      if (fired) charge();
      enqueue(shot.blob, shot.w, shot.h, new Date());
    } catch {
      setStatus(["That one didn't take", "Try again."]);
    } finally {
      busy.current = false;
    }
  }

  function enqueue(blob: Blob, w: number, h: number, capturedAt: Date) {
    const photoId = crypto.randomUUID();
    setPending((p) => p + 1);
    queue.current = queue.current
      .then(() => upload(photoId, blob, w, h, capturedAt))
      .finally(() => setPending((p) => p - 1));
  }

  // Keeps retrying while the page is open: venue signal comes and goes.
  async function upload(photoId: string, blob: Blob, w: number, h: number, capturedAt: Date) {
    const type = blob.type || "image/jpeg";
    for (let attempt = 0; ; attempt++) {
      try {
        const init = await postJSON("/api/photos/init", { eventCode: event.code, photoId, contentType: type });
        if (init.status === 409) { setLeft(0); return; }
        if (!init.ok) throw new Error(`init ${init.status}`);
        const { uploadUrl, shotsLeft } = await init.json();
        setLeft((l) => Math.min(l, shotsLeft));
        const put = await fetch(uploadUrl, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": type }, body: blob });
        if (!put.ok) throw new Error(`upload ${put.status}`);
        const done = await postJSON("/api/photos/complete", { photoId, capturedAt: capturedAt.toISOString(), width: w || undefined, height: h || undefined });
        if (!done.ok) throw new Error(`complete ${done.status}`);
        return;
      } catch {
        if (attempt >= 1) setStatus(["Waiting for signal", "Keep this page open. Your shots will finish uploading."]);
        await sleep(Math.min(15_000, 1000 * 2 ** attempt));
      }
    }
  }

  if (left === 0) return <RollDone event={event} uploading={pending} />;

  const used = event.maxShots - left;
  return (
    <section className="stack">
      <div className="cam">
        {event.decor && <div className="toran" aria-hidden />}
        <div className="cam-row">
          <div className="vf-wrap">
            <div className="vf">
              <video ref={videoRef} playsInline muted autoPlay aria-label="Viewfinder" />
              {cam !== "live" && (
                <label className="vf-msg">
                  {cam === "starting" ? "Opening camera…" : "No camera access. Tap to shoot"}
                  {cam === "off" && (
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      aria-label="Take a photo with your camera app"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) shoot(f); }}
                    />
                  )}
                </label>
              )}
            </div>
            <span className="tiny">Viewfinder</span>
          </div>
          <div className="right">
            <div className="counter">
              <span className="tiny">Shots<br />left</span>
              <div className="window" aria-label={`${left} shots left`}>
                <div className="strip" style={{ transform: `translateY(${-used * 44}px)` }}>
                  {Array.from({ length: event.maxShots + 1 }, (_, i) => <div key={i}>{event.maxShots - i}</div>)}
                </div>
              </div>
            </div>
            <button
              key={nudge}
              ref={wheelRef}
              className={`wheel${wound ? " ready" : ""}${nudge ? " nudge" : ""}`}
              type="button"
              aria-label="Wind the film. Drag sideways or tap."
              onPointerDown={(e) => { windRef.current.lastX = e.clientX; windRef.current.moved = 0; e.currentTarget.setPointerCapture(e.pointerId); unlockAudio(); }}
              onPointerMove={(e) => {
                const w = windRef.current;
                if (w.lastX === null) return;
                const dx = Math.abs(w.lastX - e.clientX);
                w.lastX = e.clientX;
                w.moved += dx;
                addWind(dx);
              }}
              onPointerUp={() => { if (windRef.current.moved < 4) addWind(40); windRef.current.lastX = null; }}
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); addWind(40); } }}
            />
            <span className="tiny">{wound ? "Wound" : "Wind ←"}</span>
          </div>
        </div>
        <div className="flash-row">
          <span className={`diya${!flash ? "" : charged ? " on" : " charging"}`} aria-hidden><i /></span>
          <button className="switch" type="button" aria-pressed={flash} onClick={toggleFlash}>{flash ? "Flash on" : "Flash off"}</button>
          <span className="tiny">{event.maxShots} EXP · ISO 400</span>
        </div>
        <div className="band"><b>blindshot</b><span>{event.chip}</span></div>
        <div>
          <div className="pips" style={{ ["--n" as string]: event.maxShots }} aria-hidden>
            {Array.from({ length: event.maxShots }, (_, i) => <i key={i} className={i < used ? "used" : undefined} />)}
          </div>
          <div className="pips-label">
            <span className="tiny">Your roll</span>
            <span className="tiny">{used} / {event.maxShots}</span>
          </div>
        </div>
      </div>
      <div className="shoot-zone">
        <button className="shutter" type="button" aria-disabled={!wound} onClick={() => shoot()}>SHOOT</button>
        <p className="status" aria-live="polite">
          {status[0]}
          {status[1] && <small>{status[1]}</small>}
          {pending > 0 && <small>{pending} uploading…</small>}
        </p>
      </div>
      <p className="fine center">Every shot joins the party&apos;s shared roll after the event.</p>
      <div className="flashfx" ref={fxRef} />
    </section>
  );
}

function RollDone({ event, uploading }: { event: EventInfo; uploading: number }) {
  return (
    <section className="stack">
      <p className="big-zero" aria-hidden>0</p>
      <h1 className="headline">That&apos;s a<br /><em>wrap.</em></h1>
      <p className="lede">Your shots are in the party&apos;s roll with everyone else&apos;s. It all develops at once, and nobody sees a frame until then.</p>
      <div className="panel">
        <div className="row">
          <span>Your shots</span>
          <span>{uploading ? `${uploading} still uploading. Keep this page open.` : "All saved"}</span>
        </div>
        <div className="row">
          <span>Develops</span>
          <span suppressHydrationWarning>{event.releaseAt ? formatWhen(event.releaseAt) : "When the host releases it"}</span>
        </div>
      </div>
      {event.released && <a className="cta" href={`/e/${event.code}/roll`}><span>See the roll</span><span aria-hidden>→</span></a>}
    </section>
  );
}

/* ---------------- helpers ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const postJSON = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function buzz(p: number | number[]) {
  try { navigator.vibrate?.(p); } catch {}
}

let ac: AudioContext | null = null;
function unlockAudio() {
  try { ac ??= new AudioContext(); void ac.resume(); } catch { ac = null; }
}
function noise(dur: number, freq: number, gain: number) {
  unlockAudio();
  if (!ac) return;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}
const click = () => { noise(0.05, 2400, 0.9); setTimeout(() => noise(0.08, 900, 0.6), 45); };
const tick = () => noise(0.015, 3800, 0.25);
function whine() {
  unlockAudio();
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(5200, t + 1.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.025, t + 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(t + 1.6);
}
