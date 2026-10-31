// The guest journey, on every mobile browser project: join, shoot a whole roll blind, see it on the shared roll.
import { expect, test, type Page } from "@playwright/test";
import { dropEvent, makeEvent, testJpeg, waitDeveloped } from "./support.ts";

async function join(page: Page, code: string, name = "Tester") {
  await page.goto(`/e/${code}`);
  await page.getByLabel("First name").fill(name);
  await page.getByLabel(/Instagram/).fill(`@${name.toLowerCase()}`);
  await page.locator("#consent").check();
  await page.locator("form button[type=submit]").click();
}

async function wind(page: Page) {
  const wheel = page.getByRole("button", { name: /Wind the film/ });
  for (let i = 0; i < 3; i++) await wheel.click();
  await expect(page.getByText("Wound")).toBeVisible();
}

// Playwright's WebKit has no fake camera device: feed it a moving test pattern through the same API.
// Camera stubs go on MediaDevices.prototype: WebKit hasn't built navigator.mediaDevices yet when init scripts run.
// Silent test runs: every audio context stays suspended, so no shutter clicks out of the laptop's speakers.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) { super(o); void this.suspend(); }
      resume() { return Promise.resolve(); }
    };
  });
});

test.beforeEach(async ({ page, browserName }) => {
  if (browserName !== "webkit") return;
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async () => {
      const c = Object.assign(document.createElement("canvas"), { width: 1280, height: 960 });
      const g = c.getContext("2d")!;
      let t = 0;
      setInterval(() => { g.fillStyle = `hsl(${t++ % 360} 60% 50%)`; g.fillRect(0, 0, c.width, c.height); }, 33);
      return c.captureStream(30);
    };
  });
});

test("join → shoot a full roll blind → developed onto the shared roll", async ({ page }) => {
  const e = await makeEvent({ shots: 2 });
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  try {
    await page.goto(`/e/${e.code}`);

    // what you can and can't do, before anything else
    await expect(page.getByText("Roll finished? Load another.")).toBeVisible();

    // consent is required
    await page.getByLabel("First name").fill("Tester");
    await page.getByLabel(/Instagram/).fill("instagram.com/Tester.Shoots/");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText(/Tick the box/)).toBeVisible();
    await page.locator("#consent").check();
    await page.locator("form button[type=submit]").click();

    // live viewfinder from the (fake) camera; the roll is already out, so it's one tap away
    await expect(page.getByLabel("2 shots left")).toBeVisible();
    await expect(page.getByRole("link", { name: /See everyone/ })).toBeVisible();
    await expect(page.getByRole("img", { name: "QR code to join E2E Party" })).toBeVisible(); // to bring friends in
    await expect(page.getByText("Finished your roll? You'll get another one.")).toBeVisible();
    await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);

    // a fresh roll comes wound: first shot is instant
    await page.getByRole("button", { name: "SHOOT" }).click();
    await expect(page.getByLabel("1 shots left")).toBeVisible();

    // after that the shutter does nothing until the film is wound
    await page.getByRole("button", { name: "SHOOT" }).click({ force: true });
    await expect(page.getByText("Wind the film first")).toBeVisible();
    await expect(page.getByLabel("1 shots left")).toBeVisible();

    // once the shot has landed, reopening the link resumes the same roll
    await waitDeveloped(e.id, 1);
    await page.reload();
    await expect(page.getByLabel("1 shots left")).toBeVisible();

    await wind(page);
    await page.getByRole("button", { name: "SHOOT" }).click();
    await expect(page.getByRole("heading", { name: /wrap/ })).toBeVisible();

    // both frames upload, get the film look, and show on the roll
    const ps = await waitDeveloped(e.id, 2);
    expect(ps.every((p) => p.captured_at)).toBe(true);
    await page.goto(`/e/${e.code}/roll?tab=mine`);
    await expect(page.locator(".frame")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "← Camera" })).toHaveAttribute("href", `/e/${e.code}`); // the way back

    // nothing was saved on the phone
    expect(downloads).toEqual([]);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);

    // ...until the guest saves a developed frame: on phones that's the share sheet ("Save Image")
    await page.evaluate(() => {
      navigator.canShare = () => true;
      navigator.share = async (d?: ShareData) => { (window as unknown as { saved: string }).saved = d!.files![0].name; };
    });
    await page.locator(".frame").first().click();
    await expect(page.getByText(/^1 \/ 2/)).toBeVisible(); // a viewer you can swipe through
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/^2 \/ 2/)).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(/^1 \/ 2/)).toBeVisible();
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { saved?: string }).saved)).toMatch(new RegExp(`^${e.code}-you-\\d\\.jpg$`));
  } finally {
    await dropEvent(e);
  }
});

test("finished roll → load a new roll without joining again", async ({ page }) => {
  const e = await makeEvent({ shots: 1 });
  const live = () => expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  const wrap = page.getByRole("heading", { name: /wrap/ });
  try {
    await join(page, e.code);
    await live();
    await page.getByRole("button", { name: "SHOOT" }).click();
    await expect(wrap).toBeVisible();
    await page.getByRole("button", { name: /Load a new roll/ }).click();
    await expect(page.getByLabel("1 shots left")).toBeVisible();
    await expect(page.getByLabel("First name")).toHaveCount(0); // still the same guest
    await live();
    await page.getByRole("button", { name: "SHOOT" }).click();
    await expect(wrap).toBeVisible();
    await waitDeveloped(e.id, 2);
  } finally {
    await dropEvent(e);
  }
});

for (const focusCheck of [false, true]) {
  test(`with the phone light${focusCheck ? " and the focus check" : ""}: the shot waits for the light, then saves`, async ({ page }) => {
    const e = await makeEvent({ shots: 2, focusCheck });
    // Emulators have no torch: pretend this camera has one, and log what the app asks of it.
    await page.addInitScript(() => {
      const w = window as unknown as { torch: boolean[] };
      w.torch = [];
      MediaStreamTrack.prototype.getCapabilities = function () { return { torch: true } as MediaTrackCapabilities; };
      MediaStreamTrack.prototype.applyConstraints = async function (c?: MediaTrackConstraints) {
        const t = (c?.advanced?.[0] as { torch?: boolean } | undefined)?.torch;
        if (t !== undefined) w.torch.push(t);
      };
    });
    try {
      await join(page, e.code);
      await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
      const t = Date.now();
      await page.getByRole("button", { name: "SHOOT" }).click();
      await expect(page.getByLabel("1 shots left")).toBeVisible();
      expect(Date.now() - t).toBeLessThan(5_000); // capped wait: never feels stuck
      expect(await page.evaluate(() => (window as unknown as { torch: boolean[] }).torch)).toEqual([true, false]); // on, then off
      await waitDeveloped(e.id, 1);
    } finally {
      await dropEvent(e);
    }
  });
}

test("flip to the front camera for a selfie: mirrored preview, the screen is the flash, and it saves", async ({ page }) => {
  const e = await makeEvent({ shots: 2 });
  await page.addInitScript(() => {
    const w = window as unknown as { facings: string[] };
    w.facings = [];
    // a phone with two cameras; remember which one the app asks for
    MediaDevices.prototype.enumerateDevices = async () => [{ kind: "videoinput" }, { kind: "videoinput" }] as MediaDeviceInfo[];
    const real = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = function (c?: MediaStreamConstraints) {
      w.facings.push(String((c?.video as MediaTrackConstraints | undefined)?.facingMode));
      return real.call(this, c);
    };
  });
  try {
    await join(page, e.code);
    const live = () => expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
    await live();
    await page.getByRole("button", { name: "Take a selfie" }).click();
    await expect(page.getByRole("button", { name: "Use the back camera" })).toBeVisible();
    await expect(page.locator("video")).toHaveClass(/mirror/);
    await live();
    const facings = await page.evaluate(() => (window as unknown as { facings: string[] }).facings);
    expect([facings[0], facings.at(-1)]).toEqual(["environment", "user"]); // back camera first, front after the flip
    await page.getByRole("button", { name: "SHOOT" }).click(); // flash is on by default: the screen lights up first
    await expect(page.getByLabel("1 shots left")).toBeVisible();
    await expect(page.locator(".flashfx")).not.toHaveClass(/hold/); // and goes back off
    await waitDeveloped(e.id, 1);
  } finally {
    await dropEvent(e);
  }
});

test("no camera access → falls back to the camera-app picker", async ({ page }) => {
  const e = await makeEvent({ shots: 2 });
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  try {
    await join(page, e.code);
    await expect(page.getByText("No camera access. Tap to shoot")).toBeVisible();
    await wind(page);
    await page.getByLabel("Take a photo with your camera app").setInputFiles({ name: "shot.jpg", mimeType: "image/jpeg", buffer: await testJpeg() });
    await expect(page.getByLabel("1 shots left")).toBeVisible();
    await waitDeveloped(e.id, 1);
  } finally {
    await dropEvent(e);
  }
});

test("camera that never opens doesn't leave the guest stuck", async ({ page }) => {
  const e = await makeEvent();
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = () => new Promise(() => {});
  });
  try {
    await join(page, e.code);
    await expect(page.getByText("Opening camera…")).toBeVisible();
    await expect(page.getByText("No camera access. Tap to shoot")).toBeVisible({ timeout: 12_000 });
  } finally {
    await dropEvent(e);
  }
});

test("a shot taken with no signal uploads once signal is back", async ({ page, context }) => {
  const e = await makeEvent({ shots: 2 });
  try {
    await join(page, e.code);
    await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
    await context.setOffline(true);
    await page.getByRole("button", { name: "SHOOT" }).click();
    await expect(page.getByText("Waiting for signal")).toBeVisible();
    await context.setOffline(false);
    await waitDeveloped(e.id, 1);
  } finally {
    await dropEvent(e);
  }
});
