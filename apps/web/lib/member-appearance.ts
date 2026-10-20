/** The subscriber app shares the platform's quiet, neutral interface.
 * Coach websites retain their own design; identity photos and names still
 * identify the coach inside the app. Explicit Light/Dark/System choices
 * are preserved by appearance.css, including the initial server render.
 */
export const MEMBER_THEME_COLORS = { light: "#ffffff", dark: "#222527" };

export const MEMBER_APP_VARIABLES: Record<string, string> = {
  "--paper": "#f3f4f0",
  "--white": "#ffffff",
  "--ink": "#171917",
  "--muted": "#616660",
  "--line": "#d9ddd5",
  "--field-border": "#616660",
  "--green": "#171917",
  "--mint": "#f3f4f0",
  "--lime": "#d5f24a",
  "--sand": "#f3f4f0",
  "--blue": "#f3f4f0",
  "--brand-primary": "#d5f24a",
  "--brand-on-primary": "#171917",
  "--brand-accent": "#d5f24a",
  "--brand-on-accent": "#171917",
  "--brand-link": "#171917",
  "--brand-tint": "#f3f4f0",
  "--brand-on-tint": "#171917",
  "--brand-font": "var(--ty-font-body)",
  "--brand-heading-font": "var(--ty-font-display)",
  "--brand-button-radius": "6px",
  "--brand-space": "24px",
  "--radius": "8px",
  "--dark-paper": "#181a1b",
  "--dark-white": "#222527",
  "--dark-ink": "#f5f6f4",
  "--dark-muted": "#b7bdb8",
  "--dark-line": "#42484a",
  "--dark-field-border": "#929a96",
  "--dark-primary": "#f5f6f4",
  "--dark-on-primary": "#181a1b",
  "--dark-link": "#f5f6f4",
  "--dark-accent": "#d5f24a",
  "--dark-on-accent": "#181a1b",
  "--dark-tint": "#2b3032",
  "--dark-on-tint": "#f5f6f4",
  "--dark-logo-plate": "#ffffff",
};
