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
  expect(html).toMatch(/<figure class="share-qr">.*<svg/s);
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

test("new rolls: only on events that allow them, only once the roll is shot, and the limit grows by one roll", async ({ baseURL }) => {
  const a = await guest(baseURL!, e);
  const init = async () => (await a.post("/api/photos/init", { data: { eventCode: e.code, photoId: randomUUID() } }));
  const roll = () => a.post("/api/session/roll", { data: { eventCode: e.code } });
  expect((await roll()).status()).toBe(403); // this event is one roll per guest

  await sql`update events set new_rolls = true where id = ${e.id}`;
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

  expect(await (await request.get(`/e/${e.code}/roll`)).text()).toContain("for guests.");
  expect(await frames(a, e, "mine")).toBe(1);
  expect(await frames(a, e)).toBe(2); // you always see your own
  expect(await frames(b, e)).toBe(1); // a's private frame is not shared

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
  const again = async () => {
    await sql`update photos set processed_at = null where id = ${id}`; // skip the 2-min wait between tries
    await develop(10_000);
  };

  await again();
  expect(await state()).toMatchObject({ status: "uploaded", attempts: 1 });
  expect((await state()).error).toBeTruthy();
  await again();
  expect(await state()).toMatchObject({ status: "uploaded", attempts: 2 });
  await again();
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

  await expect(page.locator("svg").filter({ has: page.locator("path") }).first()).toBeVisible(); // QR code
  await page.getByRole("button", { name: "☆ Star" }).click();
  await expect(page.getByRole("button", { name: "★ Starred" })).toBeVisible();
  await page.getByRole("button", { name: "Release the roll now" }).click();
  await expect(page.getByRole("button", { name: "Hide the roll again" })).toBeVisible();
  expect(await frames(a, e, "picks")).toBe(1);

  // hiding takes a frame off the guests' roll
  expect(await frames(a, e)).toBe(1);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unhide" })).toBeVisible();
  expect(await frames(a, e)).toBe(0);

  // the way back to every event
  await page.getByRole("link", { name: "← All events" }).click();
  await expect(page).toHaveURL(/\/e\/admin$/);
});
