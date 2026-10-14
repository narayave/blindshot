// An event "theme overlay": a CSS class (tokens in globals.css) plus the bits of copy and decor that change.
export const THEMES = {
  base: { chip: "NO PEEKING", decor: false },
  diwali: { chip: "SHOOT OK PLEASE", decor: true },
} as const;

export type ThemeName = keyof typeof THEMES;
export const theme = (name: string) => THEMES[(name in THEMES ? name : "base") as ThemeName];
export const themeClass = (name: string) => `theme-${name in THEMES ? name : "base"}`;
