/** Explicit development placeholders cannot serve as public policies or consent versions. */
export function isLegalPlaceholder(document: { title?: unknown; content?: unknown }): boolean {
  return /\btest placeholder\b/i.test(String(document.title ?? "")) ||
    /^\s*TEST ENVIRONMENT PLACEHOLDER\b/i.test(String(document.content ?? ""));
}
