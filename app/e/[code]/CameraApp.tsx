"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { instagramHandle } from "@/lib/config";

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
  closed: boolean; // shooting has ended for the night
  focusCheck: boolean; // camera trial (see settle)
  closesAt: string | null;
};
type Guest = { name: string; shotsUsed: number };

export default function CameraApp({ event, guest, qr }: { event: EventInfo; guest: Guest | null; qr: string }) {
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
      {me ? <Camera event={event} me={me} qr={qr} /> : <Join event={event} qr={qr} onJoined={setMe} />}
    </div>
  );
}

/* ---------------- join ---------------- */

function Join({ event, qr, onJoined }: { event: EventInfo; qr: string; onJoined: (g: Guest) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const ig = String(f.get("instagram") ?? "").trim();
    if (!name) return setErr("Add your first name so your frames are credited to you.");
    if (ig && !instagramHandle(ig)) return setErr("That Instagram handle doesn't look right. Leave it blank if you're not on Instagram.");
    if (f.get("consent") !== "on") return setErr("Tick the box to agree to how photos are shared.");
    setErr("");
    setBusy(true);
    unlockAudio();
    const res = await postJSON("/api/session", {
      eventCode: event.code,
      name,
      instagram: ig,
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
      <HowItWorks event={event} />
      {event.decor ? <div className="toran" aria-hidden /> : <div className="stripes" aria-hidden><i /><i /><i /></div>}
      <form onSubmit={submit} noValidate>
        <label className="field" htmlFor="name">First name
          <input id="name" name="name" autoComplete="given-name" required />
        </label>
        <label className="field" htmlFor="instagram">Instagram, so the host can tag you and you can find your shots again (optional)
          <input id="instagram" name="instagram" placeholder="@yourhandle" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
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
        <p className="fine">No password. Coming back later or on another phone? Use the same first name and Instagram, and your earlier shots are still yours.</p>
      </form>
      <ShareQr event={event} qr={qr} />
    </section>
  );
}

/* ---------------- camera ---------------- */

const WIND_PX = 120;
// Torch fallback: the light burns at least TORCH_MIN_MS (LED warm-up), then until brightness stops changing
// (auto-exposure has caught up), but never longer than TORCH_MAX_MS. Tune per phone.
const TORCH_MIN_MS = 500;
const TORCH_MAX_MS = 1500;
const STEADY_FRAMES = 3; // in a row, before the shot

// What you can and can't do, in five lines: shown before joining, and folded away under the camera.
function HowItWorks({ event }: { event: EventInfo }) {
  const until = event.closesAt ? ` until ${formatWhen(event.closesAt)}` : "";
  const roll = event.released ? "It's open now." : event.releaseAt ? `It opens ${formatWhen(event.releaseAt)}.` : "It opens when the host says so.";
  return (
    <ol className="how" suppressHydrationWarning>
      <li><b>{event.maxShots} shots a roll, no previews.</b> You don&apos;t see a photo until the roll opens.</li>
      <li><b>Wind, then shoot.</b> Drag or tap the wheel between shots. Flash on for dark rooms; ↻ Selfie flips the camera.</li>
      <li><b>Roll finished? Load another.</b> New film all night{until}.</li>
      <li><b>One shared roll.</b> Everyone&apos;s photos, yours included. {roll}</li>
      <li><b>Find your shots later</b> on any phone: join again with the same first name and Instagram.</li>
    </ol>
  );
}

// The event's QR code, so a guest can hand the camera on: friends scan it straight off this phone.
function ShareQr({ event, qr }: { event: EventInfo; qr: string }) {
  return (
    <figure className="share-qr">
      <div dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label={`QR code to join ${event.name}`} />
      <figcaption>Friends can scan this to join</figcaption>
    </figure>
  );
}

function Camera({ event, me, qr }: { event: EventInfo; me: Guest; qr: string }) {
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
  const facing = useRef<"environment" | "user">("environment");
  const [selfie, setSelfie] = useState(false);
  const [canFlip, setCanFlip] = useState(false);
  const windRef = useRef({ acc: 0, pos: 0, lastX: null as number | null, moved: 0 });

  async function startCamera() {
    setCam("starting");
    // Never sit on "Opening camera…": if the camera is held by another tab or the permission prompt got lost,
    // fall back to the camera-app picker. If the stream turns up later, we still go live.
    const stuck = setTimeout(() => setCam((c) => (c === "starting" ? "off" : c)), 8000);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: facing.current, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      // Only offer Flip on phones that have a second camera (labels come after permission, so ask now).
      navigator.mediaDevices.enumerateDevices().then((ds) => setCanFlip(ds.filter((d) => d.kind === "videoinput").length > 1)).catch(() => {});
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCam("live");
    } catch {
      setCam("off");
    } finally {
      clearTimeout(stuck);
    }
  }
  const stopCamera = () => streamRef.current?.getTracks().forEach((t) => t.stop());
  function flip() {
    facing.current = facing.current === "user" ? "environment" : "user";
    setSelfie(facing.current === "user");
    tick();
    startCamera();
  }

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

  // `snap` plays the shutter sound and screen flash, timed to the moment the picture is really taken.
  async function grab(snap: () => void): Promise<{ blob: Blob; w: number; h: number }> {
    const v = videoRef.current!;
    const track = streamRef.current?.getVideoTracks()[0];
    // The phone light stays on until auto-exposure settles, then we grab a frame: light first, then the shot.
    // (ImageCapture's real flash was tried: on Android it often doesn't fire, and its pre-flash lags our click.)
    const front = facing.current === "user";
    const torch = !front && flash && charged && !!track && !!(track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
    // Selfies: the front camera has no light, so the screen is the flash. White until the camera has adjusted to it.
    const screenLight = front && flash && charged && !!track && !!fxRef.current;
    if (screenLight) {
      fxRef.current!.className = "flashfx hold";
      await settle(v, track!, false);
    }
    let before = 0;
    if (torch) {
      before = luma(v);
      await track!.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {});
      await settle(v, track!, event.focusCheck);
      // Did the light actually reach the frame? If this frame isn't brighter than before it came on, take the next one.
      if (event.focusCheck && luma(v) < before + 0.015) await nextFrame(v);
    }
    try {
      snap();
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("capture failed"))), "image/jpeg", 0.92));
      return { blob, w: c.width, h: c.height };
    } finally {
      if (torch) track!.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
      if (screenLight) fxRef.current!.classList.remove("hold");
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
    const snap = () => {
      click();
      buzz(18);
      flashFx(fired);
    };
    try {
      const shot = file ? (snap(), { blob: file as Blob, w: 0, h: 0 }) : await grab(snap);
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
      .then(() => shrink(blob, w, h))
      .then((s) => upload(photoId, s.blob, s.w, s.h, capturedAt))
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
        const done = await postJSON("/api/photos/complete", { photoId, capturedAt: capturedAt.toISOString(), sentAt: new Date().toISOString(), width: w || undefined, height: h || undefined });
        if (!done.ok) throw new Error(`complete ${done.status}`);
        return;
      } catch {
        if (attempt >= 1) setStatus(["Waiting for signal", "Keep this page open. Your shots will finish uploading."]);
        await sleep(Math.min(15_000, 1000 * 2 ** attempt));
      }
    }
  }

  if (left === 0 || event.closed) return <RollDone event={event} uploading={pending} />;

  const used = event.maxShots - left;
  return (
    <section className="stack">
      <div className="cam">
        {event.decor && <div className="toran" aria-hidden />}
        <div className="cam-row">
          <div className="vf-wrap">
            <div className="vf">
              <video ref={videoRef} className={selfie ? "mirror" : undefined} playsInline muted autoPlay aria-label="Viewfinder" />
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
              onPointerUp={() => { windRef.current.lastX = null; }}
              // A tap winds a notch. On click, not pointerup: screen readers, Enter/Space and some browsers send only click.
              onClick={() => { if (windRef.current.moved < 4) addWind(40); windRef.current.moved = 0; }}
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); addWind(40); } }}
            />
            <span className="tiny">{wound ? "Wound" : "Wind ←"}</span>
          </div>
        </div>
        <div className="flash-row">
          <span className={`diya${!flash ? "" : charged ? " on" : " charging"}`} aria-hidden><i /></span>
          <button className="switch" type="button" aria-pressed={flash} onClick={toggleFlash}>{flash ? "Flash on" : "Flash off"}</button>
          {canFlip && cam === "live" && (
            <button className="switch" type="button" onClick={flip} aria-label={selfie ? "Use the back camera" : "Take a selfie"}>{selfie ? "↺ Back" : "↻ Selfie"}</button>
          )}
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
      {event.released
        ? <a className="ghost" href={`/e/${event.code}/roll`}>The roll is out. See everyone&apos;s shots →</a>
        : <p className="fine center">Every shot joins the party&apos;s shared roll after the event.</p>}
      {!event.closed && <p className="fine center">Finished your roll? You&apos;ll get another one.</p>}
      <details className="how-fold"><summary>How it works</summary><HowItWorks event={event} /></details>
      <ShareQr event={event} qr={qr} />
      <div className="flashfx" ref={fxRef} />
    </section>
  );
}

function RollDone({ event, uploading }: { event: EventInfo; uploading: number }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  // Same guest, fresh roll: the server adds a roll, and reloading picks it up with the camera ready.
  // Waits for uploads, since reloading would drop any still in flight.
  async function newRoll() {
    setLoading(true);
    setErr("");
    const r = await postJSON("/api/session/roll", { eventCode: event.code }).catch(() => null);
    if (r?.ok) return location.reload();
    setLoading(false);
    setErr((await r?.json().catch(() => null))?.error ?? "Couldn't connect. Check your signal and try again.");
  }
  return (
    <section className="stack">
      <p className="big-zero" aria-hidden>0</p>
      <h1 className="headline">{event.closed ? <>The night&apos;s<br /><em>over.</em></> : <>That&apos;s a<br /><em>wrap.</em></>}</h1>
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
      {!event.closed && (
        <>
          <button className="cta" type="button" onClick={newRoll} disabled={loading || uploading > 0}>
            <span>{uploading ? "Saving your shots…" : loading ? "Loading film…" : `Load a new roll · ${event.maxShots} shots`}</span>
            <span aria-hidden>↻</span>
          </button>
          <p className="err" role="alert">{err}</p>
        </>
      )}
      {event.released && <a className="cta" href={`/e/${event.code}/roll`}><span>See the roll</span><span aria-hidden>→</span></a>}
    </section>
  );
}

/* ---------------- helpers ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Picked photos and big video frames can be full sensor size (~4 MB); the film filter outputs 2000px, so send
// at most UPLOAD_EDGE to keep party-wifi uploads quick. Anything we can't decode goes up as-is.
const UPLOAD_EDGE = 2400;
async function shrink(blob: Blob, w: number, h: number): Promise<{ blob: Blob; w: number; h: number }> {
  if (w && Math.max(w, h) <= UPLOAD_EDGE) return { blob, w, h };
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const k = UPLOAD_EDGE / Math.max(bmp.width, bmp.height);
    if (k >= 1) return { blob, w: bmp.width, h: bmp.height };
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.92));
    return out ? { blob: out, w: c.width, h: c.height } : { blob, w, h };
  } catch {
    return { blob, w, h };
  }
}

// A tiny copy of the current video frame, for quick measurements.
const probe = (() => {
  let g: CanvasRenderingContext2D | null = null;
  return (v: HTMLVideoElement) => {
    g ??= Object.assign(document.createElement("canvas"), { width: 64, height: 48 }).getContext("2d", { willReadFrequently: true })!;
    g.drawImage(v, 0, 0, 64, 48);
    return g.getImageData(0, 0, 64, 48).data;
  };
})();
// Mean brightness, 0..1.
function luma(v: HTMLVideoElement) {
  const d = probe(v);
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / ((d.length / 4) * 765);
}
// How crisp the middle of the frame is: edge contrast in the centre, which rises as focus lands (contrast autofocus).
function sharpness(v: HTMLVideoElement) {
  const d = probe(v);
  const at = (x: number, y: number) => { const i = (y * 64 + x) * 4; return d[i] + d[i + 1] + d[i + 2]; };
  let sum = 0;
  for (let y = 12; y < 36; y++) for (let x = 16; x < 48; x++) sum += Math.abs(at(x + 1, y) - at(x, y)) + Math.abs(at(x, y + 1) - at(x, y));
  return sum;
}
// The phone light is on: wait until the picture settles before grabbing it. Always brightness (auto-exposure catching up);
// with the focus check also sharpness that has stopped improving and, on phones that report it, a lens that has
// stopped moving. Never shorter than TORCH_MIN_MS (LED warm-up) or longer than TORCH_MAX_MS.
async function settle(v: HTMLVideoElement, track: MediaStreamTrack, focus: boolean) {
  const lens = () => (track.getSettings?.() as { focusDistance?: number } | undefined)?.focusDistance;
  const start = performance.now();
  let prev = luma(v), prevSharp = sharpness(v), prevLens = lens(), calm = 0;
  while (performance.now() - start < TORCH_MAX_MS) {
    await nextFrame(v);
    const l = luma(v), s = sharpness(v), f = lens();
    const steady = Math.abs(l - prev) < 0.01 && (!focus || (s <= prevSharp * 1.03 && f === prevLens));
    calm = performance.now() - start > TORCH_MIN_MS && steady ? calm + 1 : 0;
    if (calm >= STEADY_FRAMES) return;
    prev = l;
    prevSharp = s;
    prevLens = f;
  }
}
const nextFrame = (v: HTMLVideoElement) =>
  new Promise<void>((r) => {
    setTimeout(r, 200); // never hang if the video stalls
    if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(() => r());
  });
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
