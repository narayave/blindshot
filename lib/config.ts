// Default roll length for new events. Each event stores its own max_shots, which the server enforces.
export const MAX_SHOTS = 13;
export const ORIGINALS = "originals";
export const FILTERED = "filtered";

// An Instagram handle from whatever a guest types: "@Name", "name", or a profile link. null = not a valid handle.
export function instagramHandle(input: string): string | null {
  const h = input.trim().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

// Grid-sized copy stored next to each filtered photo.
export const thumbPath = (filteredPath: string) => filteredPath.replace(/\.jpg$/, "_thumb.jpg");
