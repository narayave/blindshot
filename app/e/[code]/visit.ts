// Count a page load, or a camera diagnostic, for the darkroom. Fire-and-forget: a failure never touches the page.
export type VisitKind = "soon" | "join" | "camera" | "album" | "cam-live" | "cam-off" | "cam-stuck" | "shot" | "shot-fail" | "blocked";
export function logVisit(code: string, kind: VisitKind, detail?: string) {
  fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, kind, detail }) }).catch(() => {});
}
