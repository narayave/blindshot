// Count a page load, or a camera diagnostic, for the darkroom. Fire-and-forget: a failure never touches the page.
// Album engagement: "album" (detail = tab: picks | mine | all), "photo" (opened in the viewer; detail = photo id),
// "save" (saved; detail = photo id). Used by the stats skill (.claude/skills/blindshot-stats).
export type VisitKind = "soon" | "join" | "camera" | "album" | "photo" | "save" | "cam-live" | "cam-off" | "cam-stuck" | "shot" | "shot-fail" | "blocked";
export function logVisit(code: string, kind: VisitKind, detail?: string) {
  fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, kind, detail }) }).catch(() => {});
}
