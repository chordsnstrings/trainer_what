/** The subscriber app shares the platform's quiet, neutral interface.
 * Coach websites retain their own design; identity photos and names still
 * identify the coach inside the app. Explicit Light/Dark/System choices
 * are preserved by appearance.css, including the initial server render.
 */
export const MEMBER_THEME_COLORS = { light: "#ffffff", dark: "#222527" };

export const MEMBER_APP_VARIABLES: Record<string, string> = {
  "--paper": "#f7f8f6",
  "--white": "#ffffff",
  "--ink": "#202420",
  "--muted": "#626961",
  "--line": "#e3e6e1",
  "--field-border": "#848a82",
  "--green": "#202420",
  "--mint": "#f1f3ef",
  "--lime": "#d5f24a",
  "--sand": "#f1f3ef",
  "--blue": "#f1f3ef",
  "--brand-primary": "#202420",
  "--brand-on-primary": "#ffffff",
  "--brand-accent": "#d5f24a",
  "--brand-on-accent": "#202420",
  "--brand-link": "#202420",
  "--brand-tint": "#f1f3ef",
  "--brand-on-tint": "#202420",
  "--brand-font": "var(--ty-font-body)",
  "--brand-heading-font": "var(--ty-font-display)",
  "--brand-button-radius": "10px",
  "--brand-space": "24px",
  "--radius": "16px",
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
