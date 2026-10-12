/** Small, conservative normalizers. These interpret words; they never infer health or consent. */
export const normalizeAnswer = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'")
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/\s+/g, " ").trim();

const days = ["sun(?:day)?", "mon(?:day)?", "tue(?:s|sday)?", "wed(?:nesday)?", "thu(?:r|rs|rsday)?", "fri(?:day)?", "sat(?:urday)?"];
const arabicDays = ["الأحد|الاحد", "الإثنين|الاثنين", "الثلاثاء", "الأربعاء|الاربعاء", "الخميس", "الجمعة", "السبت"];
const dayPattern = days.map((day, i) => `(?:\\b${day}\\b|${arabicDays[i]})`).join("|");
const dayNumber = (word: string) => days.findIndex((day, i) => new RegExp(`^(?:${day}|${arabicDays[i]})$`, "i").test(word));
const all = [0, 1, 2, 3, 4, 5, 6];

/** Availability, not training frequency. Ranges wrap across Sunday; exclusions always win. */
export function statedWeekdays(input: string, previous?: number[]): number[] | undefined {
  const text = normalizeAnswer(input);
  // Hypotheticals, questions and inconsistent regional definitions need the model to clarify.
  if (/[?؟]|\b(if|maybe|might|not sure|don't know|for example|used to)\b/.test(text)) return;
  // These clauses describe frequency or mixed positive/negative availability. A bag of
  // day names cannot establish which days are available; leave the complete thought
  // to semantic extraction instead of overriding it with a confident partial guess.
  if (/\b(?:not every|not all|not daily|no longer|busy|booked|bad day)\b/.test(text)) return;
  if (/\b(?:can't|cannot|not|no|except|excluding)\b[^.;]*,[^.;]*\b(?:works?|fine|available|free)\b/.test(text)) return;
  for (const clause of text.split(/[;.\n]/)) {
    if (!new RegExp(dayPattern, "i").test(clause) && !/\b(?:weekdays?|weekends?|week days?|every day|any day|all (?:the )?days|daily|anytime)\b|أيام الأسبوع|ايام الاسبوع|نهاية الأسبوع|نهاية الاسبوع|كل يوم|جميع الأيام|أي يوم/.test(clause)) continue;
    // Restrict the fast path to a small grammar of literal availability answers.
    // Unknown qualifiers ("Monday is a bad day", "Monday is my travel day")
    // must not be converted into availability merely because a weekday occurs.
    const rest = clause.replace(new RegExp(dayPattern, "gi"), " ")
      .replace(/\b(?:weekdays?|weekends?|week days?|every day|any day|all (?:the )?days|daily|anytime)\b|أيام الأسبوع|ايام الاسبوع|نهاية الأسبوع|نهاية الاسبوع|كل يوم|جميع الأيام|أي يوم|باستثناء|ما عدا|عدا|الى|إلى/g, " ")
      .replace(/\b(?:i|we|am|m|can|cannot|can't|could|train|training|gym|work|out|on|at|in|the|a|all|only|mostly|usually|generally|available|availability|free|fine|works?|for|me|us|is|are|isn't|aren't|not|no|won't|doesn't|possible|impossible|unavailable|but|however|instead|except|excluding|other|than|apart|from|and|or|to|through|until|actually|so|any|day|days|week|per|please|you|choose|pick|decide)\b/g, " ");
    if (/\p{L}/u.test(rest)) return;
  }
  const included = new Set<number>(), excluded = new Set<number>();
  let recognized = false;
  const withoutPostfix = text.replace(new RegExp(`(${dayPattern})\\s+(?:is(?:n't| not)|won't|doesn't|is impossible|is unavailable)\\s*(?:available|work|possible)?`, "gi"), (_match, day: string) => {
    recognized = true; excluded.add(dayNumber(day)); return " ";
  });
  for (const clause of withoutPostfix.split(/\b(?:but|however|instead)\b|,\s*(?=week(?:days?|ends?)\b)|[;.\n]/)) {
    const negative = /\b(?:except(?: for)?|excluding|other than|apart from|not|no|can't|cannot|unavailable)\b|باستثناء|عدا|ما عدا/.exec(clause);
    const sections = negative ? [[clause.slice(0, negative.index), false], [clause.slice(negative.index + negative[0].length), true]] as const : [[clause, false]] as const;
    for (const [part, isNegative] of sections) {
      const target = isNegative ? excluded : included;
      const add = (values: number[]) => { recognized = true; for (const value of values) target.add(value); };
      if (/\b(?:weekdays?|week\s*days?|monday to friday)\b|أيام الأسبوع|ايام الاسبوع/.test(part)) add([1, 2, 3, 4, 5]);
      if (/\bweekends?\b|نهاية الأسبوع|نهاية الاسبوع/.test(part)) add([0, 6]);
      if (/\b(?:every day|any day|all (?:the )?days|daily|anytime)\b|كل يوم|جميع الأيام|أي يوم/.test(part)) add(all);
      const ranges = new RegExp(`(${dayPattern})\\s*(?:-|–|—|to|through|until|الى|إلى)\\s*(${dayPattern})`, "gi");
      const rest = part.replace(ranges, (_range, first: string, last: string) => {
        const start = dayNumber(first), end = dayNumber(last);
        if (start >= 0 && end >= 0) for (let offset = 0; offset <= (end - start + 7) % 7; offset++) add([(start + offset) % 7]);
        return " ";
      });
      for (const word of rest.matchAll(new RegExp(dayPattern, "gi"))) add([dayNumber(word[0])]);
    }
  }
  // An exclusion alone does not establish availability on every other day.
  if (!recognized) return;
  if (!included.size && excluded.size && previous) for (const day of previous) included.add(day);
  if (!included.size) return;
  const result = [...included].filter(day => !excluded.has(day)).sort((a, b) => a - b);
  return result;
}

export function statedMinutes(input: string): number | undefined {
  const text = normalizeAnswer(input);
  if (/[?؟]|\b(?:if|maybe|between|less than|more than|under|over|at least|travel|commut\w*|driv\w*)\b|\d\s*[-–]\s*\d/.test(text)) return;
  // Count complete duration expressions first. Never let an earlier travel time or
  // one of several different session lengths win just because its words match first.
  const durations = [...text.matchAll(/\b(?:an? hour and a half|one and a half hours|half an? hour|half hour|an? hour|one hour|\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?))\b|ساعة واحدة/g)];
  if (durations.length !== 1) return;
  const value = durations[0]![0];
  if (/hour and a half|one and a half/.test(value)) return 90;
  if (/half/.test(value)) return 30;
  if (/^(?:an? hour|one hour|ساعة واحدة)$/.test(value)) return 60;
  const number = Number(value.match(/\d+(?:\.\d+)?/)?.[0]);
  return /hours?|hrs?/.test(value) ? number * 60 : number;
}

export function refusesDecision(input: string) {
  return /\b(?:don't|do not|never|not)\s+(?:want you to\s+)?(?:choose|pick|decide|recommend|change)|\b(?:i(?:'ll| will| want to| prefer to) (?:choose|pick|decide)|let me (?:choose|pick|decide))\b/.test(normalizeAnswer(input));
}

export function decisionPermissionUnclear(input: string) {
  return /\b(?:if|unless|maybe|perhaps|might)\b|\b(?:do|does|did|should) (?:you|i|we) (?:get to |have to |need to |let you )?(?:choose|pick|decide)\b|\bor should i\b/.test(normalizeAnswer(input));
}

export function preferenceIntent(input: string): "delegated" | "recommendation" | "deferred" | "unknown" | undefined {
  const text = normalizeAnswer(input);
  // Negated permission is never a delegation.
  if (refusesDecision(text)) return;
  // A question about who decides, or hypothetical permission, is not permission.
  if (decisionPermissionUnclear(text)) return;
  if (/\b(?:you\s+(?:(?:can|should|could)\s+)?(?:choose|pick|decide)|(?:choose|pick|decide) for me|up to you|your choice|whatever you (?:think|recommend|suggest)|you let me know|go with (?:your|whatever)|take care of (?:that|it)|whatever works best)\b|اختار لي|اختر لي|أنت اختار|انت اختار/.test(text)) return "delegated";
  if (/\b(?:recommend|suggest|what would (?:work|be best)|which (?:days|times) should|what (?:days|times) should)\b|\b(?:would|could|might|is|are)\b.+\b(?:work|sensible|reasonable|enough|too much|better)\b/.test(text)) return "recommendation";
  if (/\b(?:skip(?: (?:this|it|that))?|leave (?:it|this|that) for later|come back (?:to (?:it|this|that) )?later|rather not (?:say|answer)|prefer not to (?:say|answer)|ask me later)\b/.test(text)) return "deferred";
  if (/^(?:i(?:'m| am)?\s+)?(?:not sure|don't know|do not know|no idea|unsure)(?: yet)?[.!]*$/.test(text)) return "unknown";
}

/** Minimise uneven rest gaps, then prefer a Monday start. No exercise prescription. */
export function suggestedWeekdays(available: number[], count: number): number[] | undefined {
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter(day => available.includes(day));
  if (!Number.isInteger(count) || count < 1 || count > ordered.length) return;
  let best: number[] | undefined, score = Infinity;
  for (let mask = 1; mask < 1 << ordered.length; mask++) {
    const selected = ordered.filter((_, i) => mask & (1 << i));
    if (selected.length !== count) continue;
    const gaps = selected.map((day, i) => (selected[(i + 1) % count]! - day + 7) % 7 || 7);
    let run = 1, longest = 1;
    for (const gap of [...gaps, ...gaps]) { run = gap === 1 ? Math.min(count, run + 1) : 1; longest = Math.max(longest, run); }
    const candidate = gaps.reduce((sum, gap) => sum + gap * gap, 0) + longest * 0.1 + (ordered.indexOf(selected[0]!) * 0.01);
    if (candidate < score) { best = selected; score = candidate; }
  }
  return best?.sort((a, b) => a - b);
}
