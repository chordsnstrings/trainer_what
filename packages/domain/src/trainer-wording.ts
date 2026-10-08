/** Literal trainer exclusions, shared by written and spoken channels. */
export function forbiddenTrainerPhrase(text: string, forbidden: readonly string[]) {
  const words = (value: string) => " " + value.normalize("NFKC").toLowerCase()
    .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
  const spoken = words(text);
  return forbidden.some(phrase => {
    const value = words(phrase);
    return !!value.trim() && spoken.includes(value);
  });
}
