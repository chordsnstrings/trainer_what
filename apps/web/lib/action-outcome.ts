/** A confirmed mutation stays confirmed even when the follow-up read fails.
 * Never retry a write here: uncertain external outcomes keep their own intent. */
export async function saveAndRefresh<T>(
  save: () => Promise<T>,
  refresh: () => Promise<unknown>,
) {
  const result = await save();
  try {
    await refresh();
    return { result, refreshed: true };
  } catch {
    return { result, refreshed: false };
  }
}

/** Bound reads only. Aborting a mutation is not a server-side rollback. */
export const readSignal = (method = "GET") =>
  method === "GET" ? AbortSignal.timeout(20_000) : undefined;

export function refreshMessage(locale: string = "en") {
  return locale === "ar"
    ? "تم الحفظ. تعذّر تحديث العرض؛ أعد تحميل أحدث البيانات دون تكرار الإجراء."
    : "Saved. The latest view could not load; refresh the view without repeating the action.";
}
