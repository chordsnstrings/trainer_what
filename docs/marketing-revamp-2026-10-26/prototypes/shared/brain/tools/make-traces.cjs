// Builds shared/brain/traces.json (full, canonical) and traces.client.json
// (minified, `code` and `basis.refs` stripped) from the round-2 source
// scratchpad/showcase/brain-traces.json (trainsyou-brain-trace@2).
// Round-3 fixes are listed in FIXES and applied idempotently.
// Run: node tools/make-traces.cjs   (then: npx tsx tools/verify.ts, from the repo)
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const HERE = path.join(__dirname, "..");
const SRC = path.join(HERE, "../../../showcase/brain-traces.json");
const d = JSON.parse(fs.readFileSync(SRC, "utf8"));
const T = Object.fromEntries(d.traces.map((t) => [t.id.split("-")[0], t]));
const S = Object.fromEntries(d.specialists.map((s) => [s.id, s]));

// 1. Renames carried through (round 2 renamed "Sure score" to Confidence).
for (const id of ["plan_writer", "week_reviewer"]) S[id].signsOff = "Confidence and your bar";

// 2. Every step gets explicit at/dur (ms at speed 1), in the order the code runs.
const time = (t, rows) => t.steps.forEach((s, i) => { s.at = rows[i][0]; s.dur = rows[i][1]; });
time(T.t2, [[0, 420], [460, 0], [460, 0], [460, 0], [460, 0], [600, 420]]);
time(T.t3, [[0, 400], [450, 900], [1400, 0]]);
time(T.t5, [[0, 1600], [1700, 160], [2000, 420], [2520, 300], [2900, 300], [3300, 1300]]);
time(T.t7, [[0, 160], [220, 160], [440, 420], [950, 2000], [3050, 420], [3600, 1400], [5100, 400], [5600, 2000], [7700, 300], [8100, 500], [8700, 300], [9100, 1400]]);
time(T.t9, [[0, 160], [220, 420], [680, 0], [700, 420]]);
time(T.t11, [[0, 420], [460, 0], [600, 420]]);
time(T.t12, [[0, 420], [460, 0], [600, 420]]);

// 3. Highlight words exactly as the spec lists them (each verified to trigger alone).
T.t12.steps[0].highlight = ["يعورني", "بدوخة"];

// 4. "How sure" lines for traces without a score (chat ones repeat labels.noChatScore).
const sn = {
  t2: "No score. Safety rules stop it before any AI is called.",
  t3: "No score. It's your rule, applied by code.",
  t4: "No score. Every item is marked unsure, and Priya checks each one before anything is saved.",
  t5: "No score. Your rule, applied by code.",
  t6: "Chat replies have no score. They must cite your rule. This one asked for your review instead.",
  t7: "No score. The new rule goes live only if the check passes.",
  t9: "No score. No AI was called.",
  t11: "No score. Safety rules stop it before any AI is called.",
  t12: "No score. Safety rules stop it before any AI is called.",
};
for (const k in sn) T[k].sureNote = sn[k];

// 5. The open questions from spec §1.4 "To confirm before building" as verify tags.
T.t6.verify = ["Does a picker review with no action produce the Today card \"Your Brain drafted a reply\"?"];
T.t9.verify = ["Is \"Waiting for your reply\" the Today card for a personal-review topic?"];

// 6. Wording: plan bounds read "75 min or less" (bound is maxSessionMinutes 75).
T.t10.steps[4].say = "Sessions 75 min or less ✓ · Rests 30–240 s ✓ · Equipment checked ✓";

// 7. Plan signals carry the facet and warning text decide() needs to rebuild
//    planRoute()'s reasons in the browser (verified against the domain).
T.t8.sure.signals.missing = ["equipment"];
T.t8.sure.signals.checks.list = ["The plan uses 3 of the subscriber's 4 training days"];
T.t10.sure.signals.missing = [];
T.t10.sure.signals.checks.list = [];

d.format = "trainsyou-brain-trace@2";
d.updated = "2026-10-27";
fs.writeFileSync(path.join(HERE, "traces.json"), JSON.stringify(d, null, 1) + "\n");

// Client copy: strip `code` and `basis.refs`.
const c = JSON.parse(JSON.stringify(d));
c.specialists.forEach((s) => delete s.code);
c.traces.forEach((t) => { if (t.basis) delete t.basis.refs; });
const min = JSON.stringify(c);
fs.writeFileSync(path.join(HERE, "traces.client.json"), min);
console.log("traces.json", fs.statSync(path.join(HERE, "traces.json")).size, "B; client", min.length, "B,", zlib.gzipSync(min, { level: 9 }).length, "B gz");
