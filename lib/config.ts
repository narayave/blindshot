// Default roll length for new events. Each event stores its own max_shots, which the server enforces.
export const MAX_SHOTS = 13;
export const ORIGINALS = "originals";
export const FILTERED = "filtered";

// Grid-sized copy stored next to each filtered photo.
export const thumbPath = (filteredPath: string) => filteredPath.replace(/\.jpg$/, "_thumb.jpg");
