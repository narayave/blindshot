// Server rules that must hold whatever the browser does: shot limits, ownership, what the roll shows, the host gate.
import { randomUUID } from "node:crypto";
import { expect, test, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { develop } from "../lib/process.ts";
import { dropEvent, makeEvent, photos, sql, testJpeg, waitDeveloped } from "./support.ts";

type Ev = { id: string; code: string };

async function guest(baseURL: string, e: Ev, extra: Record<string, unknown> = {}) {
  const api = await pwRequest.newContext({ baseURL });
  const r = await api.post("/api/session", { data: { eventCode: e.code, name: "Api", consent: true, ...extra } });
  expect(r.status()).toBe(200);
  return api;
}

async function shoot(api: APIRequestContext, e: Ev, id = randomUUID(), times?: { capturedAt: string; sentAt: string }) {
  const init = await api.post("/api/photos/init", { data: { eventCode: e.code, photoId: id } });
  expect(init.status()).toBe(200);
  const { uploadUrl } = await init.json();
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/jpeg" }, body: new Uint8Array(await testJpeg()) });
  expect(put.status).toBe(201);
  const now = new Date().toISOString();
  const done = await api.post("/api/photos/complete", { data: { photoId: id, ...(times ?? { capturedAt: now, sentAt: now }) } });
  expect(done.status()).toBe(200);
  return { id, uploadUrl: uploadUrl as string };
}

const frames = async (api: APIRequestContext, e: Ev, tab = "all") =>
  ((await (await api.get(`/e/${e.code}/roll?tab=${tab}`)).text()).match(/class="frame"/g) ?? []).length;

let e: Ev;
test.beforeEach(async () => { e = await makeEvent({ shots: 2 }); });
test.afterEach(async () => { await dropEvent(e); });

test("unknown event is a 404", async ({ request }) => {
  expect((await request.get("/e/no-such-party")).status()).toBe(404);
});

test("the join page carries a QR code friends can scan to join", async ({ request }) => {
  const html = await (await request.get(`/e/${e.code}`)).text();
  expect(html).toContain(`QR code to join E2E Party`);
  expect(html).toMatch(/<figure class="share-qr">[\s\S]*<svg/);
});

test("joining needs consent", async ({ request }) => {
  const r = await request.post("/api/session", { data: { eventCode: e.code, name: "A" } });
  expect(r.status()).toBe(400);
});

test("Instagram is optional, tidied to a bare handle, and nonsense is refused", async ({ request }) => {
  const join = (instagram?: string) => request.post("/api/session", { data: { eventCode: e.code, name: "Ig", consent: true, instagram } });
  expect((await join()).status()).toBe(200);
  expect((await join("@Some.One_")).status()).toBe(200);
  expect((await join("https://www.instagram.com/other.one/?hl=en")).status()).toBe(200);
  expect((await join("not a handle!")).status()).toBe(400);
  const rows = await sql<{ instagram: string | null }[]>`select instagram from sessions where event_id = ${e.id} order by created_at`;
  expect(rows.map((r) => r.instagram)).toEqual([null, "some.one_", "other.one"]);
});

test("shot limit is enforced on the server, and retries don't burn shots", async ({ baseURL }) => {
  const api = await guest(baseURL!, e);
  const id = randomUUID();
  const first = await (await api.post("/api/photos/init", { data: { eventCode: e.code, photoId: id } })).json();
  expect(first.shotsLeft).toBe(1);
  const retry = await (await api.post("/api/photos/init", { data: { eventCode: e.code, photoId: id } })).json();
  expect(retry.shotsLeft).toBe(1); // same photo id: no new shot
  expect((await (await api.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } })).json()).shotsLeft).toBe(0);
  const over = await api.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } });
  expect(over.status()).toBe(409);
});

test("new rolls: only once the roll is shot, and the limit grows by one roll", async ({ baseURL }) => {
  const a = await guest(baseURL!, e);
  const init = async () => (await a.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } }));
  const roll = () => a.post("/api/session/roll", { data: { eventCode: e.code } });
  expect((await roll()).status()).toBe(409); // roll not finished yet
  await init();
  await init();
  expect((await init()).status()).toBe(409);
  expect((await roll()).status()).toBe(200);
  expect((await roll()).status()).toBe(409); // a double tap doesn't stack rolls
  expect((await (await init()).json()).shotsLeft).toBe(1);
  expect((await (await init()).json()).shotsLeft).toBe(0);
  expect((await init()).status()).toBe(409);
  const shots = await sql<{ shot_number: number }[]>`select shot_number from photos where event_id = ${e.id} order by 1`;
  expect(shots.map((s) => s.shot_number)).toEqual([1, 2, 3, 4]);
});

test("schedule: before it opens, a countdown page but no joining or shooting; after closing, no new shots or rolls (with a grace period for late uploads)", async ({ baseURL, request }) => {
  const a = await guest(baseURL!, e);
  const init = () => a.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } });

  await sql`update events set opens_at = now() + interval '1 hour' where id = ${e.id}`;
  const soon = await request.get(`/e/${e.code}`);
  expect(soon.status()).toBe(200); // the link works the minute it's shared...
  expect(await soon.text()).toContain("Sign-ups open in");
  expect((await request.post("/api/session", { data: { eventCode: e.code, name: "Early", consent: true } })).status()).toBe(404); // ...but no joining
  expect((await init()).status()).toBe(404); // ...and no shooting, even for someone who joined before
  expect((await a.get(`/e/${e.code}/roll`)).status()).toBe(404); // ...and no roll
  await sql`update events set online = false where id = ${e.id}`;
  expect((await request.get(`/e/${e.code}`)).status()).toBe(404); // switched off: nothing at all
  await sql`update events set online = true, opens_at = now() - interval '1 hour' where id = ${e.id}`;
  expect((await request.get(`/e/${e.code}`)).status()).toBe(200);

  await sql`update events set closes_at = now() - interval '5 minutes' where id = ${e.id}`;
  expect((await init()).status()).toBe(200); // shot just before closing, still uploading: accepted
  expect(await (await a.get(`/e/${e.code}`)).text()).toContain("over."); // but the camera says the night's over
  await sql`update events set closes_at = now() - interval '20 minutes' where id = ${e.id}`;
  expect((await init()).status()).toBe(409);
  expect((await a.post("/api/session/roll", { data: { eventCode: e.code } })).status()).toBe(409);
});

test("Mine is this phone's shots: someone typing your name and Instagram on another phone sees none of them", async ({ baseURL }) => {
  const mine = await guest(baseURL!, e, { name: "Maya", instagram: "@maya.shoots", privateRoll: true });
  await shoot(mine, e);
  await shoot(mine, e);
  const impostor = await guest(baseURL!, e, { name: "Maya", instagram: "@maya.shoots" }); // a different phone (its own cookies)
  await waitDeveloped(e.id, 2);
  expect(await frames(mine, e, "mine")).toBe(2);
  expect(await frames(impostor, e, "mine")).toBe(0);
  expect(await frames(impostor, e)).toBe(0); // private stays private
  const devices = await sql<{ device_id: string | null }[]>`select device_id from sessions where event_id = ${e.id}`;
  expect(devices.every((d) => d.device_id)).toBe(true);
  expect(new Set(devices.map((d) => d.device_id)).size).toBe(2); // two phones, told apart
});

test("the same phone joining again (another visit) keeps its earlier shots under Mine", async ({ baseURL }) => {
  const phone = await guest(baseURL!, e, { name: "Sam" });
  await shoot(phone, e);
  // a second join from the same browser: new event session, same device cookie
  expect((await phone.post("/api/session", { data: { eventCode: e.code, name: "Sam", consent: true } })).status()).toBe(200);
  await shoot(phone, e);
  await waitDeveloped(e.id, 2);
  expect(await frames(phone, e, "mine")).toBe(2);
});

test("upload links can write but not read; strangers can't touch photos", async ({ baseURL, request }) => {
  const a = await guest(baseURL!, e);
  const { id, uploadUrl } = await shoot(a, e);
  expect((await fetch(uploadUrl)).status).toBe(403);

  expect((await request.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } })).status()).toBe(401);
  const b = await guest(baseURL!, e);
  expect((await b.post("/api/photos/complete", { data: { photoId: id } })).status()).toBe(403);
  expect((await b.post("/api/photos/complete", { data: { photoId: randomUUID() } })).status()).toBe(404);
});

test("roll: closed to non-guests, hidden until release, private rolls stay private", async ({ baseURL, request }) => {
  const a = await guest(baseURL!, e, { privateRoll: true });
  await shoot(a, e);
  const b = await guest(baseURL!, e);
  await shoot(b, e);
  await waitDeveloped(e.id, 2);

  const outsider = await (await request.get(`/e/${e.code}/roll`)).text(); // not signed in: the host's picks only, and a way in
  expect(outsider).toContain("Were you there?");
  expect((outsider.match(/class="frame"/g) ?? []).length).toBe(0); // nothing starred yet, so nothing shown
  expect(await frames(a, e, "mine")).toBe(1);
  expect(await frames(a, e)).toBe(2); // you always see your own
  expect(await frames(b, e)).toBe(1); // a's private frame is not shared
  await sql`update events set credit = '@the.host' where id = ${e.id}`;
  const roll = await (await b.get(`/e/${e.code}/roll`)).text(); // the night in numbers, once it's out
  expect(roll).toContain("instagram.com/veefaceswest"); // tag the maker when posting, whatever credit the photos carry
  expect(roll).not.toContain("instagram.com/the.host");
  expect(roll).toContain("The night in numbers");
  expect(roll).toMatch(/<b>2<\/b><span>photos<\/span>/); // every photo taken counts…
  expect(roll).toContain("1 was kept private by the person who took it."); // …and the stats say why Everyone shows fewer

  await sql`update events set release_at = null where id = ${e.id}`;
  expect(await (await b.get(`/e/${e.code}/roll`)).text()).toContain("developing.");
});

test("capture times are corrected for a phone clock that's off", async ({ baseURL }) => {
  const a = await guest(baseURL!, e);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString(); // this phone's clock runs an hour slow
  await shoot(a, e, undefined, { capturedAt: hourAgo, sentAt: hourAgo });
  const [p] = await photos(e.id);
  expect(Math.abs(p.captured_at!.getTime() - Date.now())).toBeLessThan(60_000);
});

test("a failed develop is retried, and only the third failure sticks", async ({ baseURL }) => {
  test.skip(!!process.env.BASE_URL, "drives the worker code directly");
  const a = await guest(baseURL!, e);
  const id = randomUUID();
  await a.post("/api/photos/init", { data: { eventCode: e.code, photoId: id } });
  // completed, but the original never reached storage: every develop of it fails
  expect((await a.post("/api/photos/complete", { data: { photoId: id } })).status()).toBe(200);
  const state = async () => (await sql<{ status: string; attempts: number; error: string | null }[]>`select status, attempts, error from photos where id = ${id}`)[0];
  // One more try: free the claim (skipping the 2-min wait) and develop until this photo's attempt count moves.
  // Other tests in this process may be developing at the same moment, so a single develop() can be a no-op.
  const again = async (attempts: number) => {
    await sql`update photos set processed_at = null where id = ${id}`;
    await expect.poll(async () => { await develop(5_000); return (await state()).attempts; }, { timeout: 30_000 }).toBe(attempts);
  };

  await again(1);
  expect(await state()).toMatchObject({ status: "uploaded", attempts: 1 });
  expect((await state()).error).toBeTruthy();
  await again(2);
  expect(await state()).toMatchObject({ status: "uploaded", attempts: 2 });
  await again(3);
  expect(await state()).toMatchObject({ status: "failed", attempts: 3 });
});

test("rolls page: one switch per event turns the guests' view on and off", async ({ page, baseURL }) => {
  test.skip(!process.env.ADMIN_PASSWORD, "needs ADMIN_PASSWORD");
  await sql`update events set release_at = null where id = ${e.id}`;
  const a = await guest(baseURL!, e);
  await shoot(a, e);
  await waitDeveloped(e.id, 1);
  expect(await (await a.get(`/e/${e.code}/roll`)).text()).toContain("developing.");

  await page.goto("/e/admin");
  await expect(page.locator(".roll-row")).toHaveCount(0); // nothing about any event before the password
  await page.getByLabel("Host password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /Open the darkroom/ }).click();
  await expect(page).toHaveURL(/\/e\/admin$/); // login comes back here, not to the darkroom
  const row = page.locator(".roll-row").filter({ hasText: `/e/${e.code}` });
  const toggle = row.getByRole("switch", { name: /guests see the roll/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(await frames(a, e)).toBe(1); // guests see it now

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await (await a.get(`/e/${e.code}/roll`)).text()).toContain("developing.");
});

test("an event switched off is a 404 for guests (pages, joining, shooting), but not for the host", async ({ baseURL, request, page }) => {
  const a = await guest(baseURL!, e);
  await sql`update events set online = false where id = ${e.id}`;
  expect((await request.get(`/e/${e.code}`)).status()).toBe(404);
  expect((await request.get(`/e/${e.code}/roll`)).status()).toBe(404);
  expect((await request.post("/api/session", { data: { eventCode: e.code, name: "B", consent: true } })).status()).toBe(404);
  expect((await a.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } })).status()).toBe(404);
  expect(await (await request.get(`/e/${e.code}`)).text()).not.toContain("E2E Party"); // not even the name

  test.skip(!process.env.ADMIN_PASSWORD, "needs ADMIN_PASSWORD");
  await page.goto("/e/admin");
  await page.getByLabel("Host password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /Open the darkroom/ }).click();
  await expect(page.getByLabel("Host password")).toBeHidden(); // logged in
  expect((await page.goto(`/e/${e.code}`))!.status()).toBe(200); // the host can still look
  await expect(page.getByText(/This event is OFF/)).toBeVisible(); // and is told guests can't
  await page.goto("/e/admin");
  const live = page.locator(".roll-row").filter({ hasText: `/e/${e.code}` }).getByRole("switch", { name: /event is live/ });
  await expect(live).toHaveAttribute("aria-checked", "false");
  await live.click();
  await expect(live).toHaveAttribute("aria-checked", "true");
  expect((await request.get(`/e/${e.code}`)).status()).toBe(200); // back for everyone
});

test("darkroom: password gate, star a frame, release the roll", async ({ page, baseURL }) => {
  test.skip(!process.env.ADMIN_PASSWORD, "needs ADMIN_PASSWORD");
  await sql`update events set release_at = null where id = ${e.id}`;
  const a = await guest(baseURL!, e);
  await shoot(a, e);
  await waitDeveloped(e.id, 1);

  await page.goto(`/admin?event=${e.code}`);
  await page.getByLabel("Host password").fill("definitely-wrong");
  await page.getByRole("button", { name: /Open the darkroom/ }).click();
  await expect(page.getByText("That password isn't right.")).toBeVisible();

  await page.getByLabel("Host password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /Open the darkroom/ }).click();
  await expect(page.getByLabel("Host password")).toBeHidden();
  await page.goto(`/admin?event=${e.code}`);
  await expect(page.getByRole("heading", { name: "E2E Party" })).toBeVisible();
  await expect(page.getByLabel("Funnel")).toContainText("opened the link"); // visited → signed up → took photos

  await expect(page.locator("svg").filter({ has: page.locator("path") }).first()).toBeVisible(); // QR code
  // tapping a photo opens the developed (film) version; the untouched original is its own button
  await expect(page.locator(".card img").first().locator("xpath=..")).toHaveAttribute("href", /\/filtered\//);
  await expect(page.getByRole("link", { name: "Original" }).first()).toHaveAttribute("href", /\/originals\//);
  await page.getByRole("button", { name: "☆ Star" }).click();
  await expect(page.getByRole("button", { name: "★ Starred" })).toBeVisible();
  await page.getByRole("button", { name: "Release the album now" }).click();
  await expect(page.getByRole("button", { name: "Hide the album again" })).toBeVisible();
  expect(await (await a.get(`/e/${e.code}/roll?tab=picks`)).text()).not.toContain("Host picks"); // guests get Mine + Everyone only

  // hiding takes a frame off the guests' roll
  expect(await frames(a, e)).toBe(1);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unhide" })).toBeVisible();
  expect(await frames(a, e)).toBe(0);

  // the way back to every event
  await page.getByRole("link", { name: "← All events" }).click();
  await expect(page).toHaveURL(/\/e\/admin$/);
});

test("darkroom wiggles: same-moment shots from two phones → group them → tap the subject", async ({ page, baseURL }) => {
  test.skip(!process.env.ADMIN_PASSWORD, "needs ADMIN_PASSWORD");
  const w = await makeEvent({ shots: 3 });
  try {
    const at = new Date().toISOString();
    const [a, b] = [await guest(baseURL!, w, { name: "Ana" }), await guest(baseURL!, w, { name: "Ben" })]; // two phones
    const sa = await shoot(a, w, undefined, { capturedAt: at, sentAt: at });
    const sb = await shoot(b, w, undefined, { capturedAt: at, sentAt: at });
    await waitDeveloped(w.id, 2);

    await page.goto(`/admin?event=${w.code}`);
    await page.getByLabel("Host password").fill(process.env.ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /Open the darkroom/ }).click();
    await expect(page.getByLabel("Host password")).toBeHidden();
    await page.goto(`/admin?event=${w.code}&view=wiggles`);
    await page.getByRole("button", { name: "Make a wiggle" }).click();

    const tap = page.getByRole("img", { name: "By Ana: tap the subject" });
    await expect(tap).toBeVisible();
    await expect(page.getByLabel("Preview").locator("img")).toBeVisible(); // the aligned loop
    const box = (await tap.boundingBox())!;
    await tap.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
    await expect.poll(async () => (await sql`select wiggle_x, wiggle_y from photos where id = ${sa.id}`)[0]).toEqual({ wiggle_x: expect.closeTo(0.25, 1), wiggle_y: expect.closeTo(0.75, 1) });
    const [g] = await sql`select count(distinct wiggle)::int as groups, count(*)::int as n from photos where id in (${sa.id}, ${sb.id}) and wiggle is not null`;
    expect(g).toEqual({ groups: 1, n: 2 });
    await page.screenshot({ path: test.info().outputPath("wiggles.png"), fullPage: true });

    await page.getByRole("button", { name: "Ungroup" }).click();
    await expect(page.getByRole("button", { name: "Make a wiggle" })).toBeVisible(); // back to a candidate

    // or pick any frames by hand on the All tab (e.g. one phone testing alone)
    await page.goto(`/admin?event=${w.code}&view=all`);
    for (const box of await page.getByLabel("Wiggle").all()) await box.check();
    await page.getByRole("button", { name: "Make a wiggle from the ticked frames" }).click();
    await expect(page).toHaveURL(/view=wiggles/);
    await expect(page.getByRole("img", { name: "By Ben: tap the subject" })).toBeVisible();
  } finally {
    await dropEvent(w);
  }
});

test("home page: where it's been (real nights only) and how to book it", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("Where it&#x27;s been");
  expect(html).toContain("instagram.com/veefaceswest"); // want one at your event? message the maker
  expect(html).not.toContain("Test Roll"); // the owner's bench never shows
  expect(html).not.toContain("E2E Party"); // nor automated test events
});

test("album: the host's starred photos lead Everyone (shuffled, steady per viewer); Mine stays newest first", async ({ baseURL }) => {
  const ev = await makeEvent({ shots: 3, released: true });
  try {
    const a = await guest(baseURL!, ev);
    const first = await shoot(a, ev);
    await shoot(a, ev);
    await waitDeveloped(ev.id, 2);
    await sql`update photos set starred = true where id = ${first.id}`; // star the older one
    const order = async (tab: string) => [...(await (await a.get(`/e/${ev.code}/roll?tab=${tab}`)).text()).matchAll(/alt="Frame (\d+) by/g)].map((m) => m[1]);
    expect((await order("all"))[0]).toBe("1"); // the starred (older) frame leads Everyone
    expect(await order("all")).toEqual(await order("all")); // the shuffle is steady for this viewer
    expect((await order("mine"))[0]).toBe("2"); // Mine: newest first, stars don't reorder it
  } finally {
    await dropEvent(ev);
  }
});

test("album after the party: anyone sees the host's picks; adding a name opens the whole album on the same page", async ({ page, baseURL }) => {
  const ev = await makeEvent({ shots: 3 });
  try {
    const a = await guest(baseURL!, ev); // a guest's two photos from the night (no camera needed)
    const first = await shoot(a, ev);
    await shoot(a, ev);
    await waitDeveloped(ev.id, 2);
    await sql`update photos set starred = true where id = ${first.id}`; // the host's pick
    // someone not signed in on this browser (e.g. tapping the link inside Instagram)
    await page.goto(`/e/${ev.code}/roll`);
    await expect(page.getByText("Host's picks")).toBeVisible();
    await expect(page.locator(".frame")).toHaveCount(1); // only the starred one
    await page.locator(".frame").first().click(); // the public picks: look, don't save
    await expect(page.getByRole("button", { name: /Save photo|Getting photo/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: /Tick the box/ })).toBeDisabled(); // they agree first
    await page.getByLabel("Name", { exact: true }).fill("Visitor");
    await page.locator("#view-agree").check();
    await page.getByRole("button", { name: "See the whole album" }).click();
    await expect(page.locator(".frame")).toHaveCount(2); // the same page, now everything
    await expect(page.locator('.tabs a[aria-current="page"]')).toContainText("Everyone"); // nothing of theirs, so Everyone
    // and signing in afterwards doesn't add a "camera" to the night's stats
    await sql`update events set closes_at = now() - interval '1 hour' where id = ${ev.id}`;
    await sql`update sessions set created_at = now() where event_id = ${ev.id} and name = 'Visitor'`;
    await sql`update sessions set created_at = now() - interval '3 hours' where event_id = ${ev.id} and name <> 'Visitor'`;
    await page.reload();
    await expect(page.locator(".night-grid div").nth(1)).toContainText("1"); // 1 camera: the guest, not the visitor
    // signed in after the party: they can save too (people want the photos others took of them)
    await page.locator(".frame").first().click();
    await expect(page.getByText(/^1 \/ 2/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save photo|Getting photo/ })).toHaveCount(1);
    expect(await page.locator(".lightbox img").first().getAttribute("src")).not.toContain("_thumb"); // full size
  } finally {
    await dropEvent(ev);
  }
});

test("album: 'Show more frames' adds the next 40 below, without reloading the page or jumping to the top", async ({ page, baseURL }) => {
  const ev = await makeEvent({ shots: 50 });
  try {
    const a = await guest(baseURL!, ev);
    const [s] = await sql<{ id: string }[]>`select id from sessions where event_id = ${ev.id}`;
    // 45 developed frames, straight into the table (the album only reads rows; the images needn't exist)
    for (let i = 1; i <= 45; i++)
      await sql`insert into photos (id, event_id, session_id, shot_number, original_path, filtered_path, status, captured_at)
        values (${randomUUID()}, ${ev.id}, ${s.id}, ${i}, ${"x/" + i + ".jpg"}, ${"x/" + i + ".jpg"}, 'done', now() - ${i + " minutes"}::interval)`;
    void a;
    await page.goto(`/e/${ev.code}/roll`);
    await page.getByLabel("Name", { exact: true }).fill("Viewer");
    await page.locator("#view-agree").check();
    await page.getByRole("button", { name: "See the whole album" }).click();
    await expect(page.locator(".frame")).toHaveCount(40);
    await page.evaluate(() => { (window as unknown as { stay: boolean }).stay = true; }); // gone if the page reloads
    await page.getByRole("link", { name: "Show more frames" }).scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    await page.getByRole("link", { name: "Show more frames" }).click();
    await expect(page.locator(".frame")).toHaveCount(45);
    expect(await page.evaluate(() => (window as unknown as { stay?: boolean }).stay)).toBe(true); // same page, no reload
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(y * 0.8); // still down where we were
    await expect(page.getByRole("link", { name: "Show more frames" })).toHaveCount(0); // that's all of them
  } finally {
    await dropEvent(ev);
  }
});
