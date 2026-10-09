export const PREVIEW_PAGE = "/trainer/preview";
export const PREVIEW_RUN = "/api/v1/trainer-preview/run";
const currentPath = () => typeof window === "undefined" ? "" : window.location.pathname;
export function isTrainerPreview(path: string | null = currentPath()) {
  return typeof path === "string" && (path === PREVIEW_PAGE + "/app" || path.startsWith(PREVIEW_PAGE + "/app/"));
}
export function subscriberPath(path: string) {
  return isTrainerPreview(path) ? path.slice(PREVIEW_PAGE.length) : path;
}
export function memberHref(href: string, path: string | null = currentPath()) {
  return isTrainerPreview(path) && /^\/app(?:[/?#]|$)/.test(href) ? PREVIEW_PAGE + href : href;
}
export function memberApiUrl(url: string, path = currentPath()) {
  return isTrainerPreview(path) && url.startsWith("/api/v1/") && !url.startsWith("/api/v1/trainer-preview/") && url !== "/api/v1/trainer-preview"
    ? PREVIEW_RUN + url.slice("/api/v1".length) : url;
}
export function previewDestinationAllowed(path: string) {
  return /^\/app(?:\/(?:chat|program|timeline|progress|twin|intake|more|nutrition(?:\/log)?|workouts\/[^/]+|voice-session\/(?:planned\/)?[^/]+|guided\/[^/]+))?$/.test(path);
}
