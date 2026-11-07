// Count a page load for the darkroom's funnel. Fire-and-forget: a failure never touches the page.
export function logVisit(code: string, kind: "soon" | "join" | "camera" | "album") {
  fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, kind }) }).catch(() => {});
}
