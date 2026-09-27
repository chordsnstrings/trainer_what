/**
 * Synthetic mock data for the end-to-end sandbox: three trainer workspaces
 * with teaching material and offers, and about twenty followers. Every name,
 * address and bank number here is fictitious; IBANs are check-digit valid
 * but belong to no bank.
 */
export type TrainerPlan = {
  slug: string;
  name: string;
  email: string;
  city: string;
  category: string;
  audience: string;
  accent: string;
  headline: string;
  bio: string;
  sources: Array<{ title: string; text: string }>;
  workoutPriceMinor: number;
  nutrition: boolean;
  runtime: boolean;
  voice: boolean;
  website: boolean;
  followers: { invited: number; publicJoin: number };
};

export const PASSWORD = "Sandbox-Only-Password-2026!";

export const TRAINERS: TrainerPlan[] = [
  {
    slug: "layla-strength",
    name: "Layla Haddad",
    email: "layla.coach@sandbox.example",
    city: "Dubai",
    category: "Strength training",
    audience: "Busy professionals building strength three days a week",
    accent: "#1f6f5c",
    headline: "Strength that fits a busy week",
    bio: "Layla coaches practical full-body strength with clear progressions. Synthetic sandbox profile.",
    sources: [
      {
        title: "Strength progression",
        text: [
          "When all prescribed squat sets are completed with two reps in reserve, add 2.5 kg to the barbell squat next session.",
          "If a lifter misses squat reps on two consecutive sessions, keep the same load and repeat the session.",
          "Swap the barbell back squat for a goblet squat when no squat rack is available.",
          "Schedule three full-body sessions per week with a rest day between training days.",
          "Always train to failure on the final set of accessory curls.",
          "Stop the session and message your coach if you feel sharp joint pain.",
        ].join(" "),
      },
      {
        title: "Recovery and communication",
        text: [
          "Sleep at least seven hours before heavy training days to support recovery.",
          "Reply to missed-session messages with a short plan to return on the next scheduled day.",
          "Never train to failure on accessory curls during the first four weeks of a program.",
          "Use a deload week with half the working sets after every sixth training week.",
        ].join(" "),
      },
    ],
    workoutPriceMinor: 29900,
    nutrition: true,
    runtime: true,
    voice: true,
    website: true,
    followers: { invited: 5, publicJoin: 4 },
  },
  {
    slug: "omar-conditioning",
    name: "Omar Farouk",
    email: "omar.coach@sandbox.example",
    city: "Abu Dhabi",
    category: "Conditioning",
    audience: "Runners and team-sport players improving conditioning",
    accent: "#8a3b12",
    headline: "Conditioning for runners and team sports",
    bio: "Omar programs intervals and strength support for endurance athletes. Synthetic sandbox profile.",
    sources: [
      {
        title: "Interval training",
        text: [
          "When interval pace feels easy for all repeats, add one extra interval repeat next week.",
          "Schedule interval sessions on non-consecutive days with an easy run between them.",
          "Swap treadmill intervals for bike intervals when running causes shin soreness.",
          "Reply to missed-run messages by moving the run to the next free training day.",
        ].join(" "),
      },
      {
        title: "Recovery basics",
        text: [
          "Sleep at least eight hours during high-mileage weeks to support recovery.",
          "Stop running and message your coach if you feel chest pain or dizziness.",
          "Use an easy recovery week with shorter runs after every third hard week.",
        ].join(" "),
      },
    ],
    workoutPriceMinor: 24900,
    nutrition: false,
    runtime: false,
    voice: false,
    website: true,
    followers: { invited: 3, publicJoin: 3 },
  },
  {
    slug: "sara-mobility",
    name: "Sara Nasser",
    email: "sara.coach@sandbox.example",
    city: "Sharjah",
    category: "Mobility",
    audience: "Desk workers improving mobility and posture",
    accent: "#3f3d99",
    headline: "Move better, one session at a time",
    bio: "Sara builds short mobility routines for desk workers. Synthetic sandbox profile.",
    sources: [
      {
        title: "Mobility routine",
        text: [
          "When hip mobility drills feel comfortable for two weeks, add one extra set of hip openers.",
          "Schedule four short mobility sessions per week before the working day.",
          "Swap floor stretches for standing stretches when kneeling is uncomfortable.",
          "Reply to missed-session messages with a five-minute routine for the next morning.",
          "Stop stretching and message your coach if you feel sharp nerve pain.",
          "Sleep at least seven hours to support recovery between mobility sessions.",
        ].join(" "),
      },
    ],
    workoutPriceMinor: 14900,
    nutrition: false,
    runtime: false,
    voice: false,
    website: false,
    followers: { invited: 3, publicJoin: 2 },
  },
];

const FIRST = ["Aisha", "Hamza", "Mariam", "Yousef", "Noor", "Karim", "Huda", "Tariq", "Lina", "Samir", "Rania", "Faris", "Dana", "Ziad", "Maya", "Adel", "Salma", "Bilal", "Hind", "Rami"];
const LAST = ["Khalil", "Mansour", "Saleh", "Aziz", "Rahman", "Qasim", "Haddad", "Najjar", "Sabbagh", "Darwish"];
export function followerName(i: number) {
  return `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
}

/** Check-digit valid UAE IBAN (AE + 2 + 3-digit bank + 16-digit account). */
export function uaeIban(seed: number) {
  const bban = "033" + String(1000000000000000 + seed * 7919).slice(-16);
  const numeric = (bban + "AE00").replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const digit of numeric) mod = (mod * 10 + Number(digit)) % 97;
  return "AE" + String(98 - mod).padStart(2, "0") + bban;
}

/** Brain held-out prompts: two paraphrase-style questions per rule, escalation for safety rules. */
export function brainScenarioPrompts(rules: Array<{ id: string; data: any }>) {
  const out: Array<{ prompt: string; expectedEvidenceId: string; expectEscalation: boolean }> = [];
  const safety = /pain|dizz|chest/i;
  let round = 0;
  while (out.length < 20 && round < 6) {
    for (const rule of rules) {
      if (out.length >= 20) break;
      const directive = String(rule.data.directive);
      const escalate = safety.test(directive);
      const prompt = escalate
        ? round % 2
          ? "During my workout today I felt sharp pain in my knee joint. What should I do now?"
          : "I got dizzy with chest pain on my run this morning, can I keep training?"
        : `${["Coach, quick question:", "Help me decide:", "Please advise:", "Client check-in:", "Question for my plan:", "Situation today:"][round]} ${directive.replace(/\.$/, "")}. What should I do next?`;
      out.push({ prompt, expectedEvidenceId: rule.id, expectEscalation: escalate });
    }
    round++;
  }
  return out;
}

/** A small valid JPEG for brand media, made with sharp (already an app dependency). */
export async function sampleJpeg(color: string, label = 0) {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width: 800 + label, height: 600, channels: 3, background: color },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}
