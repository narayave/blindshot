# User stories

Grouped by persona. Each story lists its acceptance criteria and how it's tested:

- `e2e`: Playwright on emulated mobile Chrome, Samsung Internet, Safari (WebKit) and Firefox with a fake camera
- `api`: HTTP tests against the running app (route handlers, roll pages)
- `unit`: the film filter and other pure functions
- `load`: `npm run load`, many guests shooting at once against a deployment
- `manual (real phone)`: what emulators can't reach: the phone light, real camera hardware, OS permission prompts

---

## Guest

### G1. Join without an account
As a guest, I want to join from a QR code with just my name (and my Instagram, if I want to be tagged), so that I can start shooting in seconds.
- The event link opens in the phone's browser; no app install, no password.
- Name and the consent tick are required; joining without consent is refused.
- Instagram is optional. "@Name", "name" or a profile link all become the bare handle; anything else is refused.
- Joining sets a cookie, so reopening the link resumes my roll with the same shots left.
- An unknown event code shows a not-found page.

Coverage: `e2e` `api`

### G2. Opt out of sharing
As a guest, I want to keep my photos out of promotion or out of the shared roll, so that I control where my face ends up.
- When the event allows opt-outs, the join form shows "no promotional use" and "keep my photos out of the shared roll".
- Private-roll photos are visible only to me (Mine tab) and the host.
- The host sees both flags on each of my frames.
- When the event turns opt-outs off, the boxes aren't shown.

Coverage: `api` (private roll), `manual` (host flags, opt-outs switched off)

### G3. Shoot blind
As a guest, I want a camera with a tiny viewfinder and no preview, so that I stay in the moment instead of checking my phone.
- The viewfinder is one inch wide; the taken photo is never shown.
- The shutter does nothing until I wind the film with the thumbwheel; an unwound press tells me to wind.
- The shot counter goes down by one per shot, and the roll ends at zero.

Coverage: `e2e`

### G4. Use the flash
As a guest, I want a flash that lights the scene when the photo is taken, so that dark party shots come out.
- With the flash on, the phone light comes on before the capture and stays on until exposure settles.
- The click, screen flash and capture happen together, after the light is on.
- The flash recharges after firing; switching it off skips the light.
- Browsers without light control fall back to the screen flash only.

Coverage: `manual (real phone)`: emulators have no phone light

### G5. Fixed roll, enforced by the server
As a guest, I want a hard 13-shot limit, so that each shot counts and nobody can game it.
- The server reserves each frame atomically; two fast taps can't overrun the limit.
- A shot past the limit is refused (409), and the camera shows the end of the roll.
- Retrying the same shot (same photo id) doesn't spend another frame.

Coverage: `api` `e2e`

### G6. Nothing saved on my phone
As a guest, I want photos to go straight to the event and not my camera roll, so that the roll stays a surprise and my storage stays clean.
- Frames are captured from the live stream in memory and uploaded; no download, no gallery save.
- The upload URL can write one file only and can't read anything back.

Coverage: `api` (write-only URL), `e2e` (no downloads, no local storage), `manual (real phone)` (camera roll stays empty)

### G7. Uploads survive bad signal
As a guest at a crowded venue, I want shots to keep uploading when signal drops, so that none are lost.
- Uploads run in a background queue; I can keep shooting while they finish.
- Failed uploads retry with backoff, and the status line says to keep the page open.
- Closing the page while uploads are pending asks for confirmation.
- Photos are shrunk to 2400 px on the phone before upload.

Coverage: `e2e` (shot taken offline uploads when back online), `manual (real phone)`

### G8. Camera fallback
As a guest whose camera won't open, I want another way to shoot, so that I'm not stuck on a loading screen.
- If camera access is denied, or the viewfinder hasn't opened in 8 seconds, a "Tap to shoot" picker opens the phone's own camera app.
- If the stream turns up later, or I return to the tab, the live viewfinder comes back.
- Picked photos count against the roll like any other shot.

Coverage: `e2e` (denied permission, camera that never opens), `manual (real phone)` (camera held by another app)

### G9. See the shared roll
As a guest, I want to see everyone's photos after the party, so that I get the whole night, not just my 13 frames.
- Before release, the roll says when it develops and shows no one else's photos.
- After release: Everyone, Host picks and Mine tabs.
- Hidden frames and other guests' private-roll frames never appear; my own private frames appear in Mine.
- Grids load thumbnails; tapping opens the full frame.
- Any frame I can see, I can save: on phones the share sheet ("Save Image" puts it in the camera roll), elsewhere a download.
- Only people who joined the event can open the roll.

Coverage: `e2e` `api`

### G10. Works on my phone's browser
As a guest, I want it to work in whatever browser opens the QR code, so that I don't have to switch apps.
- Join, shoot, upload and roll work on mobile Chrome, Safari, Samsung Internet and Firefox.
- The layout fits a phone screen with no sideways scrolling.

Coverage: `e2e` (all four engines), `manual (real phone)` (iPhone + Android)

---

## Host

### H1. Darkroom behind a password
As a host, I want a private admin page, so that only I can manage the event.
- `/admin` asks for the admin password; a wrong password is refused.
- The session cookie holds a proof of the password, never the password.

Coverage: `e2e`

### H2. Watch the event live
As a host, I want to see stats and every frame as it arrives, so that I know the camera is being used.
- Counts of guests, shots and processed frames per event.
- New frames appear with thumbnails, the guest's name and their opt-out flags.
- A frame is developed within about a minute of landing, and within a few minutes after a rush (the worker runs every minute).

Coverage: `manual`

### H3. Curate
As a host, I want to star, hide and retry frames, so that the shared roll shows the night at its best.
- Starring puts a frame in Host picks; hiding removes it from every guest view.
- A frame whose processing failed can be retried.
- The untouched original is always one click away.

Coverage: `e2e` (star, hide), `manual` (retry)

### H4. Release the roll
As a host, I want to choose when the roll develops, so that the reveal happens after the party.
- Events can have a release time, or be held until I release them by hand.
- Release and hold are switches in the darkroom and take effect immediately.

Coverage: `e2e` `api`

### H5. QR code to print
As a host, I want a printable QR code for the event, so that guests can join from a poster or table card.
- The darkroom shows a QR code that opens the event link on the live domain.

Coverage: `e2e` (QR renders)

### H6. Wigglegram-ready capture times
As a host, I want shots that several guests take together to line up in time, so that I can stitch them into a wigglegram later.
- Each upload sends the phone's clock; the server corrects the capture time for that phone's clock skew.
- Frames shot together by different guests land within a fraction of a second of each other.

Coverage: `api`

---

## Product owner

### P1. One consistent film look
As the product owner, I want every photo developed with the same recipe, so that the roll looks like one camera shot it.
- A fixed tone curve, colour grade, grain, vignette, dust and fibres; no per-photo subject detection.
- Light leaks on about 25% of frames, more likely on the first and last frame.
- HEIC, EXIF orientation and odd sizes are handled; output is a 2000 px JPEG plus a 640 px thumbnail with no EXIF or GPS.

Coverage: `unit` (repeatable per seed, 2000 px, never upscaled, upright, no EXIF, leak rate), `manual` (HEIC)

### P2. Watermark that's always readable
As the product owner, I want a credit on every photo that's readable on any background, so that shared photos carry the brand.
- Bottom-right, Special Elite, sized relative to the frame.
- Tone flips light or dark from the brightness behind it, with an opposite-tone halo.
- Readable on white, black, grey and noisy frames.

Coverage: `unit` (placement), `manual` (readability on real photos)

### P3. Themes per event
As the product owner, I want each event to have its own look without new code, so that I can sell the same camera to many hosts.
- An event picks a theme (colours, decor, band text) by name.
- The base theme and the Diwali theme render the same flow with different styling.

Coverage: `manual` (tests run the Diwali theme)

### P4. Free to run
As the product owner, I want the stack to cost close to nothing between events, so that small events are worth doing.
- Hosting on the Azure Static Web Apps Free plan, database on Supabase free tier, storage billed per GB, filtering on pay-per-use Azure Functions.
- Deploys from `main` with no manual steps; pull requests get preview URLs. The worker deploys with `scripts/deploy-worker.sh`.

Coverage: `manual` (deploy pipeline)

### P5. Survives the party rush
As the product owner, I want 100 guests pressing the shutter at the same moment to all get their photo in, so that the busiest moment of the night is the one that works.
- 100 simultaneous shots all upload with no failures, and the site stays responsive during and after.
- Every one of them is developed within minutes. Developing never slows down uploads: it runs on a separate worker.

Coverage: `load`, on the live site: 100 at once all uploaded within 18 s and developed in about 4 min; 200 guests × 3 bursts (600 photos) all uploaded within 41 s each and developed at about 30 a minute, with no failures.
