export const views = new Map<string, unknown>();
export const draftPrefix = "trainer-workspace-draft:";
let sessionVersion = 0;
export const workspaceSessionVersion = () => sessionVersion;

export function clearWorkspaceViews() {
  sessionVersion++;
  views.clear();
  if (typeof window === "undefined") return;
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(draftPrefix)) sessionStorage.removeItem(key);
  } } catch {}
  window.dispatchEvent(new Event("workspace-session-cleared"));
}
