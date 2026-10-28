/* The playground ("Throw a moment at your Brain", /trainer-brain and /demo):
   its first frame, as HTML strings. Pure: no CSS, no DOM, nothing at import,
   so the server render (render.ts) and the tests import it; play.js, the
   runtime, adopts the same markup and builds on these atoms. Ported from the
   approved prototype's static half (docs/marketing-revamp-2026-10-26/
   prototypes/shared/brain/brain-play.js, in concept A's skin) with the
   changes of docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1 and WP3b:
   - the root's inner HTML only (render.ts writes the root); heading: false
     leaves the H2 to the page;
   - every inner id starts with the host id (o.id): the prototype rendered
     undefined-* ids;
   - the call to action comes from the options (ui.js cta());
   - the frame is the first moment (t1) played to its end: node states, the
     steps, the result and its settings. Visitors who never get the engine
     read all of it, and the engine starts from it without moving anything;
     its controls wait, disabled, for the engine;
   - with attract (the page plays that moment once on its own), what the run
     plays carries .sc-res and the nodes look idle until the engine starts
     (app/brain-stage.css, app/brain-play.css);
   - no live region of its own: the engine announces through the overlay
     layer's (core.js say());
   - "Step by step" and "Change a setting" are phone-only toggles over
     regions the desktop always shows, so no width needs another first
     frame; the Pause label keeps one width; the canvas, the skip link, the
     stamp and the "Throw them all" box are the engine's to add;
   - "How we count" is a disclosure, so it opens without the engine;
   - the steps' heading sits one level under the heading that names the
     playground: an H3 under its own H2 or the band's (labelledBy), an H2
     where the page's H1 names it (heading: false and no labelledBy, /demo). */
import { esc } from "./core.js";
import { decide, defaults, isOff } from "./decide.js";
import * as U from "./ui.js";

/** The root element's classes for each kind this module renders (render.ts). */
export const ROOT = { play: "bp" };

export const COPY = {
  h2: "Throw a moment at your Brain", lede: "Pick something a member might say. Watch each check and specialist work. Then change a setting and run it again.",
  placeholder: "Or type what a member might say", run: "Run it", all: "Throw them all", change: "Change a setting", again: "Run it again",
  panel: "What each step said", skip: "Skip to result", steps: "Step by step", moments: "Sample moments",
  closest: "Closest sample: {chip}. This page can't read new messages.", none: "No sample is close to that. This page can't read new messages: pick a sample moment.",
  more: "More moments", specialty: "Your specialty",
  allTitle: "Every sample moment at once", back: "Back to one moment", result: "Result", off: "Built and tested. Not on yet.",
  picks: "Code picks", stop: "STOP · No AI called", pause: "Pause", play: "Play", how: "How we count",
  lock: "Safety rules · can't switch off", lockTip: "Safety rules can't be switched off. You can only make them stricter.",
};
/** The moment the first frame shows played, and the one attract plays. */
export const FIRST = "t1";
/** "Your specialty" only reorders the chips (traces by number; the first 6 show on phones). */
export const SPECS = [["strength", "Strength", [1, 6, 8, 2, 5, 10, 3, 9, 7, 4, 11, 12]], ["weight_loss", "Weight loss", [4, 10, 8, 9, 2, 1, 3, 6, 7, 5, 12, 11]],
  ["muscle_gain", "Muscle gain", [10, 1, 8, 9, 4, 6, 5, 2, 3, 7, 12, 11]], ["prenatal", "Pre- and postnatal", [11, 2, 12, 10, 5, 4, 9, 1, 8, 6, 3, 7]]];
/* Free text → the closest sample, through this table only: no network, and
   not the app's safety rules (the owner's default). Its first three rows are
   wider than the app's red-flag screen (packages/domain/src/red-flags.ts):
   whatever the screen holds maps to a moment the safety rules stop, never to
   one that is sent (tests/marketing-anatomy-play.test.ts runs the screen's own
   test messages through it). Specific matches first, so "chest pain" is t12,
   not t2. Text no row matches gets no sample at all. */
const fold = (s) => s.normalize("NFKC").replace(/(^|[^\p{L}\p{N}])([وفبك]?)الأم(?![\p{L}\p{N}])/gu, "$1$2ام").replace(/[ً-ٰٟـ]/g, "")
  .replace(/[آأإٱ]/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[ىی]/g, "ي").replace(/ة/g, "ه").replace(/[’‘`]/g, "'")
  .replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6f0).replace(/\s+/g, " ").toLowerCase();
/** English (folded, lower case) and Arabic (folded as the app folds it; a word may take clitics and the article). */
const R = (en, ar) => new RegExp(`(?:${en})|(?:^|[^\\p{L}])[وفبلك]{0,2}(?:ال)?(?:${ar})(?![\\p{L}])`, "iu");
const KEYS = [
  // pregnancy and its warning signs
  [R("pregnan|miscarr|amniotic|braxton|\\blabou?r\\b|eclampsia|\\bwaters? (?:(?:has|have|just|may have|might have|i think|think) )*(?:broke|broken|breaking)|(?:baby|bump|fetus|foetus|fetal|foetal)\\b.{0,30}\\b(?:mov|kick)|\\b(?:pelvic|vaginal) (?:pressure|bleeding|discharge)|" +
    "spotting\\b(?! (?:me|you|him|her|them|us|each other|someone|somebody|people|others|a (?:friend|partner|lifter|client|mate|buddy)|my (?:friend|partner|mate|buddy|wife|husband|client|brother|sister)|the (?:bar|lift|lifter|bench|squat|press)|(?:for|on|during|while|from) |properly|correctly|safely|technique|tips|cues|position|necessary|required|needed|etiquette|arms?|hands|drills?|duty|is |isn'?t|was |are |will |would |should |can ))|" +
    "(?:had|having|have|felt|feel|getting|get|got|been having) (?:a |another |some |regular |strong |real |bad |painful )?contractions?|contractions? (?:every|since|again|started|are|keep)|leak\\w* (?:\\w+ ){0,2}(?:fluid|water|liquid)|(?:fluid|liquid) (?:\\w+ ){0,2}(?:leak|gush|trickl|coming out)",
    "حامل|حوامل|اجهاض|تسمم ?(?:ال)?حمل|جنين|بيبي|تنقيط|ولاده ?مبكره|انقباضات(?! ?(?:ال)?عضل)|تقلصات|امنيوسي|(?:ال)?طلق ?(?:ال)?(?:مبكر|متكرر|منتظم|قوي|مستمر)|(?:بدا|بدء|جاني|اجاني|عندي|يجيني) ?(?:ال)?طلق|" +
    "نزول ?(?:ال)?(?:ماء|مويه|موي|سائل|سوائل|مياه|دم)|(?:تسرب|تسريب|خروج) ?(?:ال)?(?:ماء|مويه|سائل|سوائل|مياه)|كيس ?(?:ال)?(?:ماء|مويه|مياه)|(?:طفل|بيبي|جنين)\\p{L}* ?(?:\\S+ )?(?:يتحرك|يرفس|تحرك|رفس|يدف)"), 11],
  // the heart, breathing, fainting, blood, blood pressure and sugar, self-harm, eating disorders
  [R("chest (?:pains?|tightness|pressure|hurts?|aches?|discomfort)|chest (?:feels?|felt|is|was|gets?|got|went|has been|keeps getting) (?:(?:really|very|so|a bit|a little|kind of|kinda|all) )?(?:tight|heavy|squeezed|crushed|sore|painful)|(?:tight\\w*|heav\\w*|discomfort|crushing) (?:in|on|across|around) (?:my|the) chest|(?:pressure|squeez\\w*) (?:in|on|across|around) my chest|(?:a|my) tight chest|pain in (?:my|the) chest|" +
    "faint|pass(?:ed|es|ing)? out|black(?:ed|ing)? ?outs?\\b|lost consciousness|unconscious|collaps|keeled over|dizz|light[\\s-]?head|vertigo|(?:room|everything|world|head) (?:\\w+ )?spinning|" +
    "short(?:ness)? of breath|(?:can'?t|cannot|can not|couldn'?t|could not|hard to|trouble|difficulty|struggl\\w*)(?: to)? breath|breathless|out of breath|catch (?:my|his|her) breath|wheez|gasping|palpitat|irregular heart|skipp?(?:ed|ing) beats?|heart ?beats? (?:\\w+ ){0,2}(?:irregular|weird|strange|funny|off|skip)|" +
    "heart\\s*(?:attack|flutter|skipping|beating irregularly|out of rhythm)|heart\\s*(?:(?:is|was|keeps|kept) )?(?:racing|pounding) (?:at rest|while (?:resting|sitting|lying)|sitting (?:down|still)|lying down|for no reason)|" +
    "bleed|\\bbled\\b|blood(?! ?(?:work|tests?|results?|type|donation|panel|orange|count))|severe headache|(?:blurr\\w*|double|fuzzy) (?:vision|eyes?|sight)|vision (?:\\w+ ){0,2}(?:black|dark|grey|gray|white|blurr|fuzzy)|seeing (?:spots|stars|double|flash)|slurr|droop|(?:weakness|numbness) (?:in|on|down) one side|seizure|lost (?:my )?(?:vision|sight)|" +
    "\\bb\\.? ?p\\b(?! ?\\d{2,3} ?(?:kg|kgs|kilos?|lbs?|x|reps?))|systolic|diastolic|hypertens|(?:my|his|her) pressure|glucose|glucometer|\\bbgl?\\b|\\bbsl\\b|\\bcgm\\b|libre|dexcom|finger ?prick|(?:my|her|his|your) sugars?\\b|sugar (?:levels?|readings?|was|is|dropped|crashed|low|high)|" +
    "\\bsugar\\W{0,3}(?:\\w+ ){0,2}\\d{2,3}(?! ?(?:g\\b|grams?|gr\\b|kcal|cal\\b|%|per\\b|a day|/ ?day))|\\bhypo|(?:diabet|insulin|metformin|type ?[12]\\b|\\bt[12]d\\b).{0,60}(?:shak|trembl|jitter|sweat|clammy|confus|disorient|dizz|faint)|(?:shak|trembl|jitter|sweat|clammy|confus|disorient).{0,60}(?:diabet|insulin|metformin)|" +
    "suicid|self[\\s-]?harm|kill\\w* myself(?! (?:in|at|on|with|during|doing|over) )|(?:end|ending|ended) (?:my (?:own )?life|it all)|(?:take|taking|took) my (?:own )?life(?! back)|(?:think|thought|feel|felt)\\w* (?:like |about |of )?(?:just )?end(?:ing)? it(?: all| already| forever| for good| tonight)?(?:[.!?,;]|$)|(?:want|wanna|going) (?:to )?die|better off (?:dead|without me)|wish i (?:was|were)(?:n'?t)? (?:dead|here|alive|around)|never (?:been born|existed)|" +
    "(?:hurt|harm|cut|burn)\\w* myself(?! (?:some )?(?:slack|a break|off|short|out|down|in|deadlifting|lifting|training))|(?:don'?t|do not|no longer|can'?t|cannot) (?:want to (?:live(?! (?:on|off|in|at|with|near|there|here|abroad|without))|be alive|be here|exist|wake up(?! (?:early|at|so|before|for|to|in))|go on)|see (?:the|any) point)|(?:no|the) (?:reason|point) (?:to|in|of) (?:live|living|going on|being alive|life)|(?:want|wanna|wish i could) (?:to )?(?:just )?disappear(?! (?:into|for (?:a|the) |on |to ))|" +
    "bulimi|anorexi|binge(?:d|s|ing)?(?![\\s-]*(?:watch|on (?:netflix|tv|youtube|shows?|series|episodes?)))|bingeing|binging|eating disorder|\\barfid\\b|orthorexi|purg(?:e|ed|es|ing)(?! (?:the|my|old|stale|expired|all|of|data|records?|backups?|logs?|cache|files?|emails?|inbox|fridge|cupboards?|pantry|closet|wardrobe))|laxative|diuretic|water pills?|(?:make|made|making) myself (?:sick|throw|vomit|puke)|(?:throw\\w*|threw) up|vomit|\\bpuk(?:e|ed|es|ing)\\b|starv|" +
    "(?:barely|hardly|not|never) eat|eat\\w* (?:almost |next to )?nothing|(?:haven'?t|have not|hasn'?t|didn'?t|did not) (?:eaten|eat)|stopp?(?:ed|ing) eating(?= *(?:[.!?,;]|$)| (?:altogether|completely|entirely|properly|again|at all|for|since|this week|today|because|to (?:lose|drop|cut|get|make)|so|and(?! drinking)))|restricting(?! (?:carbs?|sugar|salt|sodium|alcohol|caffeine|dairy|gluten|fodmaps?|calories|kcal|my (?:carbs?|sugar|salt|caffeine|alcohol|calories)))|relaps|" +
    "skip\\w* (?:\\w+ ){0,3}meals|skip\\w* (?:breakfast|lunch) and|cutting (?:out )?meals|fast(?:ing|ed) for (?:days|weeks|a week|\\d+|two|three|four|five|six|seven)|slipping back|sliding back|(?:back (?:to|into|in)|slipp\\w* (?:back )?into|fall\\w* back into|fell back into|old) (?:\\w+ ){0,2}(?:habits|ways|patterns|behaviou?rs|thoughts|disorder)|" +
    "(?:eat\\w*|ate|consuming|living on|surviving on|intake (?:is|was|of)|down to) (?:\\w+ ){0,3}~?\\d{2,3} ?(?:k?cals?|calories|kilocalories)\\b(?! (?:deficit|surplus|less|more|fewer|extra|over|under|above|below|short|off|burn\\w*|so far|until|by|for|before|after|during|within|around|pre|post|per (?:meal|snack|serving)|a (?:meal|snack|serving)|each|at|in|of|from|with))",
    "ضيق ?(?:في ?|ب)?(?:ال)?(?:صدر|تنفس|نفس)\\p{L}*|صعوبه ?(?:في ?|ب)?(?:ال)?تنفس|(?:لا|ما|مو|مش|لم) ?(?:اقدر|قدرت|اقدرت|استطيع|استطعت|استطع|قادر|قادره) ?(?:علي ?)?(?:ال|ا)?تنفس|نفسي ?(?:مقطوع|ينقطع|قاطع)|انقطع ?نفسي|انهج|الهث|" +
    "[ايتن]?دوخ\\p{L}*|دايخ\\p{L}*|اغماء|اغمي\\p{L}*|غبت ?عن ?(?:ال)?وعي|غاب ?(?:عني ?)?(?:ال)?وعي|فقد\\p{L}* ?(?:ال)?وعي|غيبوبه|انهرت|(?:ال)?دنيا ?(?:[تد]لف|لفت|دارت|تدور|سودت|اظلمت)|اسودت|نزيف|[يت]?نزف\\p{L}*|نزفت|دم|دماء|خفقان|(?:ضربات|دقات|نبضات) ?(?:ال)?قلب\\p{L}*|(?:قلبي|نبضي) ?(?:\\S+ ){0,2}(?:[يت]دق|[يت]خفق|يضرب|سريع|[يت]تسارع|غير|مو|مش)\\p{L}*|نوبه ?قلبيه|جلطه|صداع ?شديد|" +
    "كتمه|صدر\\p{L}* ?(?:\\S+ ){0,2}(?:[يت]عور|[يت]وجع|[يت]ولم|الم|وجع|ضيق|ضايق|ثقيل|مكتوم|كتمه|يضغط|مشدود|يعصر)\\p{L}*|(?:الم|وجع|ثقل|ضيق|كتمه) ?(?:في ?|علي ?|ب)?(?:ال)?صدر\\p{L}*|(?:ضغط|عصره|عصر) ?(?:في|علي) ?صدر\\p{L}*|" +
    "ضغطي|ضغط ?(?:ال)?دم(?:ي)?|(?:ال)?ضغط ?(?!صدر|كتف|اكتاف|رجل|بنش|دمبل|دامبل|بار|مائل)(?:\\S+ )?(?:عالي|مرتفع|طالع|رافع)\\p{L}*|ارتفاع ?(?:\\S+ )?(?:ال)?ضغط|انقباضي|انبساطي|سكري|سكر ?(?:ال)?دم|(?:ال)?سكر(?:ي)? ?(?:\\S+ ){0,2}\\d+(?! ?(?:غ|غرام|جرام|جم|ملعقه|g|gr|grams?))|(?:هبوط|انخفاض|نزول) ?(?:في ?)?(?:ال)?سكر\\p{L}*|(?:ال)?سكر(?:ي)? ?(?:عندي ?)?(?:نازل|طايح|منخفض|واطي|هابط|نزل|طاح|هبط|انخفض|مرتفع|عالي)|جلوكوز|غلوكوز|انسولين|" +
    "انتحار|[اين]?نتحر\\p{L}*|(?:اقتل|قتل|اوذي|ايذاء|اجرح|جرحت|اضر|احرق|[اتين]?جوع|جوعت|احرم) ?(?:ال)?نفس\\p{L}*|(?:انهي|انهاء) ?حياتي|(?:ابي|ابغي|ابغا|اريد|ودي|بدي) ?(?:ان ?)?اموت(?! ?(?:من ?)?(?:ال)?(?:ضحك|جوع|تعب|حر|برد|وناسه|فرح|عطش|شوق|ملل|طفش))|اتمني ?(?:ال)?موت|اتمني ?(?:اني|لو) ?(?:اموت|ميت|مت)|" +
    "(?:ما|لا|مو) ?(?:ابي|ابغي|اريد|ودي|بدي) ?(?:ان ?)?(?:اعيش|احيا|اكمل ?حياتي)|(?:ما|لا|مو) ?(?:اشوف|اري|اجد|لقيت) ?(?:اي ?)?(?:فايده|داعي|معني|سبب) ?(?:من|ل|في) ?(?:ال)?(?:حياه|حياتي|عيش)|(?:ما ?(?:في|فيه|له)|لا ?يوجد) ?(?:فايده|داعي|معني) ?(?:من|ل) ?(?:ال)?(?:حياه|حياتي|عيش)|(?:تعبت|زهقت|مليت) ?من ?(?:ال)?حياه|" +
    "[اتين]?تقيا\\p{L}*|[اتين]?تقيء\\p{L}*|تقيات|تقيو|استفراغ|[اتين]?ستفرغ\\p{L}*|استفرغت|[اتين]?طرش\\p{L}*|ترجيع|ملين\\p{L}*|مسهل\\p{L}*|شراهه|بشراهه|نهم|بنهم|(?:امتنع|امتنعت|ممتنع\\p{L}*) ?عن ?(?:ال)?اكل|انتكاس\\p{L}*|انتكست|[اين]?نتكس\\p{L}*|بوليميا|بوليميه|انوركسيا|انوريكسيا|انوركسيه|فقدان ?(?:ال)?شهيه|اضطراب\\p{L}* ?(?:ال)?(?:اكل|طعام)|" +
    "(?:ما|لا|مو) ?(?:اكل|اكلت|اكلنا|قاعد ?اكل|قاعده ?اكل|صرت ?اكل) ?(?:شي|شيء|ولا ?شي|اي ?شي|ابد|نهائيا)(?! ?(?:بعد|قبل|الساعه|في ?الليل|بالليل|وقت|من ?(?:ال)?(?:صبح|صباح|فجر|ظهر|عصر)|اليوم|الحين|للحين|لين ?الحين))|(?:[اتين]?ترك|تركت|[اتين]?فوت|فوتت|[اتين]?سحب ?علي|سحبت ?علي|[اتين]?طنش|طنشت|[اتين]?تخطي|تخطيت) ?(?:\\S+ )?(?:ال)?(?:وجبات|وجباتي|وجبتين|اكلي)|(?:اكل|باكل|صرت ?اكل|اكلي) ?(?:\\S+ ){0,2}\\d{2,3} ?(?:سعره|سعرات|كالوري\\p{L}*)"), 12],
  // pain and injuries
  [R("pain|\\bhurt|injur|sprain|\\bstrain|pulled (?:a |my )?(?:\\w+ )?muscle|\\bnumb(?:ness)?\\b|\\bache|\\baching|\\bachy|swell|swollen|bruis|\\btor[en]\\b|\\btear (?:in|of)\\b|\\b[ampl]cl\\b|meniscus|ligament|tendon|achilles|rotator cuff|labrum|cartilage|ruptur|snapped|dislocat|sublux|\\bpop(?:ped|ping|s)?\\b|(?:heard|felt|got|had|there was) (?:a |this )?(?:\\w+ )?(?:snap|crack|clunk|rip)\\b|" +
    "gave (?:way|out)|giv\\w* (?:way|out)|give (?:way|out)|(?:knees?|ankles?|hips?|joints?|shoulders?|elbows?|wrists?|jaw) (?:\\w+ ){0,3}(?:buckl|collaps|lock|unstable|loose|catch|caught|stuck|jam|seiz|popped|slipped|came out)|buckled|instability|unstable (?:knee|ankle|hip|shoulder|joint)|locked (?:up )?(?:knee|ankle|hip|elbow|jaw|joint|shoulder)|(?:lock|locks|locked|locking) up|(?:popped|slipped|came) out of|(?:rolled|twisted|turned|went over on) (?:my |the )?(?:\\w+ )?(?:ankle|knee|wrist)|\\bknee",
    "الم|الام|[يت]ولم\\p{L}*|[اين]?تالم\\p{L}*|متالم\\p{L}*|[يت]?وجع\\p{L}*|اوجاع|موجوع\\p{L}*|[يت]عور\\p{L}*|عورني|اصابه|اصابات|مصاب\\p{L}*|التواء|ملتوي\\p{L}*|تمزق\\p{L}*|تنميل|خدر|ورم|تورم|متورم\\p{L}*|وارم\\p{L}*|انتفاخ|منتفخ\\p{L}*|نافخ\\p{L}*|منفوخ\\p{L}*|كدم\\p{L}*|انخلع\\p{L}*|خلع|رباط\\p{L}*|غضروف\\p{L}*|ركبه|ركبتي\\p{L}*|ركبتين|من ?مكان\\p{L}*|" +
    "(?:ركب|كتف|كوع|مرفق|ورك|رسغ|معصم|مفصل|كاحل|ظهر|رقب)\\p{L}* ?(?:\\S+ ){0,2}(?:علق|يعلق|تعلق|يقفل|تقفل|قفل|انقفل|يخون|خان|طلع|يطلع|طقت|انفك)\\p{L}*"), 2],
  [/creatine|supplement|protein powder|pre-workout|vitamin|medication/i, 9], [/deload|skip|rest week/i, 6], [/easy|heavier|add weight|go up|\brir\b/i, 1],
  [/photo|meal|\bate\b|lunch|calories/i, 4], [/tired|sleep|recovery|whoop|hrv/i, 3], [/\bnew\b|plan|programme/i, 10], [/week/i, 8], [/voice|talk|session/i, 5],
];
/** The closest sample's trace id ("t1"…"t12"), or null when no sample is close. */
export const closest = (text) => { const t = fold(text), k = KEYS.find(([re]) => re.test(t)); return k ? "t" + k[1] : null; };
/** The AI specialists code picks from, in the "Your Brain" shell. */
export const COACH = ["reply_picker", "draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines"];
const KIND = { chat_action: "Chat · a rule fits", chat_review: "Chat · a rule fits", topic: "Chat · your topic", floor: "Chat", plan: "", meal: "Meal photo", voice: "Before a voice session", learn: "Chat · no rule fits", recovery: "Workout starts" };
/** The kind of moment, as the shell's tag shows it (code picks the specialist from it). */
export const kindTag = (t, r) => (t.decide == "plan" ? (t.channel == "week_end" ? "Week ends" : "New plan") : r.steps.some((s) => s.sp == "draft_writer") && t.decide != "learn" ? "Chat · no rule fits" : KIND[t.decide]);
export const RES = { clear: "pass", read: "pass", found: "pass", pass: "pass", applied: "pass", confirmed: "pass", asks: "pass", score: "pass", none: "warn", warn: "warn", skipped: "skip",
  sent: "sent", waits: "waits", paused: "paused", picked: "lit", review: "lit", wrote: "lit", estimated: "lit", suggested: "lit" };
/** A step's node state once it has run: a safety hit stops, any other hit warns. */
export const stateOf = (s) => (s.result == "hit" ? (s.sp == "safety" ? "hit" : "warn") : RES[s.result] || "pass");
/** The Confidence node's value: the plan's score against your bar; chat has none. */
export const sureVal = (t, r) => (r.sure ? r.sure.display.replace(" · your bar", " · bar") : t.sure ? "" : "—");
const initials = (n) => n.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

/* ------------------------------------------------------------------ atoms */
/** "Change and run again": only the settings this moment reads. u: the host id. */
export function controlsHTML(d, t, S, u) {
  const L = d.labels, out = [];
  const rng = (k, lab, min, max, v, unit = "%") => `<label class="bp-ctl"><span>${esc(lab)}</span><span class="bp-rng"><input type="range" data-k="${k}" min="${min}" max="${max}" step="1" value="${v}" aria-valuetext="${v}${unit}"><output>${v}${unit}</output></span></label>`;
  const sw = (k, lab, on, sub) => `<label class="bp-ctl bp-sw"><input type="checkbox" role="switch" data-k="${k}"${on ? " checked" : ""}><span>${esc(lab)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`;
  const seg = (k, lab, opts, v) => `<div class="bp-ctl"><span id="${u}-${k}">${esc(lab)}</span><div class="bp-seg" role="radiogroup" aria-labelledby="${u}-${k}">${opts.map(([val, txt]) => `<button type="button" role="radio" data-k="${k}" data-v="${val}" aria-checked="${String(val) == String(v)}" tabindex="${String(val) == String(v) ? 0 : -1}">${esc(txt)}</button>`).join("")}</div></div>`;
  for (const c of t.controls) {
    if (c == "level") out.push(seg("level", "Brain level", [1, 2, 3].map((n) => [n, `${n} ${L.levels[n].name}`]), S.level) + `<p class="bp-sum">${esc(L.levels[S.level].summary)}</p>` +
      (t.decide == "chat_action" ? sw("lastCheckPassing", "Last check: passed (sample)", S.lastCheckPassing, L.levels.note) : ""));
    if (c == "capPct") out.push(rng("capPct", "Maximum increase (%)", 1, 10, S.capPct));
    if (c == "minRir") out.push(rng("minRir", "Minimum recorded repetitions in reserve", 1, 10, S.minRir, ""));
    if (c == "safetyLocked") out.push(`<button type="button" class="bp-lock" data-lock aria-describedby="${u}-locktip">${U.icon("lock")}<span>${esc(COPY.lock)}</span></button><p class="bp-locktip" id="${u}-locktip" hidden>${esc(COPY.lockTip)}</p>`);
    if (c == "threshold") out.push(rng("bar", L.planSetting.label, L.planSetting.min, L.planSetting.max, S.bar));
    if (c == "planMode") out.push(seg("planMode", "Delivery", [["automatic", "Sends automatically when it is sure"], ["supervised", "Waits for me (every plan comes to me)"]], S.planMode));
    if (c == "addEquipmentRule") out.push(sw("addEquipmentRule", "Add a confirmed rule about equipment", S.addEquipmentRule));
    if (c == "oneMoreApproved") out.push(sw("oneMoreApproved", "Approve one more similar plan", S.oneMoreApproved));
    if (c == "loggedShare") out.push(seg("loggedShare", "How much of the week she logged", [[1, "All"], [0.5, "Half"], [0.25, "A quarter"]], S.loggedShare));
    if (c == "supplementsTopic") out.push(sw("supplementsTopic", "Supplement questions: I answer myself", S.supplementsTopic, "Your choice · off by default"));
    if (c == "tooHeavyPct") out.push(rng("tooHeavyPct", "When a client says “too heavy”, lower the next set by up to (%)", 0, 20, S.tooHeavyPct));
    if (c == "recoveryReading") out.push(seg("recoveryReading", "Today's recovery (sample reading)", [[25, "25%"], [55, "55%"], [80, "80%"]], S.recoveryReading));
    if (c == "recoveryOn") out.push(sw("recoveryRule", "My recovery rule is on", S.recoveryRule, L.recoveryCaption));
    if (c == "lowLoadPct") out.push(rng("lowLoadPct", "Low recovery: lower the load by (%)", 0, 30, S.lowLoadPct));
    if (c == "lowVolumePct") out.push(rng("lowVolumePct", "Low recovery: lower the volume by (%)", 0, 50, S.lowVolumePct));
  }
  return out.join("") || `<p class="bp-sum">This moment has no setting to change. ${t.decide == "meal" ? "The member confirms every item." : "Try another moment."}</p>`;
}
/** The result column: the lane, what the member sees, what you see, your rule. */
export function resultHTML(d, t, r, prev) {
  if (r.off) return `<div class="bp-offcard"><b>${esc(t.chip)}</b>${U.lane(d, "sent", "is-dashed")}<p>${esc(COPY.off)}</p><ul>${t.steps[1].detail.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="bp-note">${esc(d.labels.basis.tests)} · ${esc(d.labels.recoveryCaption)}</p></div>`;
  const changed = prev && prev != r.lane;
  return `<div class="bp-res-h">${esc(COPY.result)} · ${esc(t.member)}</div><div class="bp-lanewrap">${U.lane(d, r.lane)}${changed ? U.lane(d, prev, "is-ghost") : ""}</div>` +
    (r.why || changed ? `<p class="bp-why">${changed ? `Before: ${esc(d.labels.lanes[prev])}. Now: ${esc(d.labels.lanes[r.lane])}. ` : ""}${r.why ? "Why: " + esc(r.why) : ""}</p>` : "") +
    (r.tag ? `<p class="bp-note"><span class="bp-tag">${esc(r.tag)}</span> ${esc(r.note || "")}</p>` : r.note ? `<p class="bp-note">${esc(r.note)}</p>` : "") +
    (r.sure ? U.sure(d, t, r) : "") + U.phone(d, t, r) + `<div class="bp-yousee"><span class="bp-k">What you see</span>${U.today(d, t, r)}</div>` + U.rule(t);
}
/** The member's message; hl: the words a safety hit marks. */
export const msgHTML = (t, hl) => `<div class="bp-msg"><span class="bp-av">${esc(initials(t.member))}</span><div class="bp-mb"><div class="bp-mh"><b>${esc(t.member)}</b><span>${esc(t.channel.replace(/_/g, " "))} · ${esc(t.when)} · sample</span></div>` +
  `<p class="bp-mt" dir="${t.trigger.lang == "ar" ? "rtl" : "ltr"}" lang="${t.trigger.lang}">${hl ? hlText(t.trigger.text, hl) : esc(t.trigger.text)}</p>${t.trigger.gloss ? `<p class="bp-gloss">${esc(t.trigger.gloss)}</p>` : ""}</div></div>`;
export function hlText(txt, words) {
  let s = esc(txt);
  for (const w of words) s = s.split(esc(w)).join(`<mark class="bp-hl">${esc(w)}</mark>`);
  return s;
}
/** The steps' "code picks" row, just before the one AI specialist it picked; isPick: that step. */
export const picksRow = (d, i) => `<li class="sc-step bp-picks" data-i="${i}">${esc(d.labels.picks)}</li>`;
export const isPick = (d, s) => s.sp in d.sp && d.sp[s.sp].kind == "ai" && s.sp != "learner";
const chipHTML = (d, t, S, on) => `<button type="button" class="bp-chip" data-t="${d.short(t)}" aria-pressed="${on}"${isOff(t, S) ? " data-off" : ""}>${esc(t.chip)}${isOff(t, S) ? `<small>${esc(d.labels.status.not_on_yet)}</small>` : ""}</button>`;

/** The diagram: checks first, the shell code picks one specialist in, checks after, the lanes, what learns, the shelf, your rulebook. */
function nodesHTML(d, S, t, r, a) {
  const end = {};
  for (const s of r.steps) end[s.sp] = [stateOf(s), s.result == "skipped" ? "Not reached" : ""];
  if (end.confidence) end.confidence[1] = sureVal(t, r);
  else end.confidence = ["idle", sureVal(t, r)];
  const n = (sp, o) => {
    const e = end[sp], html = U.node(sp, d, o);
    return e ? html.replace('data-state="idle"', `data-state="${e[0]}"`).replace('<span class="sc-val" aria-hidden="true"></span>', `<span class="sc-val" aria-hidden="true">${esc(e[1])}</span>`) : html;
  };
  // The safety node is the platform's rule, as a stop's result names it ("Platform safety rules", "{APP_NAME}. Can't switch off.").
  const safe = d.sp.safety, rule = d.trace("t2").rule;
  const safety = n("safety", { title: false }).replace('data-sp="safety"', `data-sp="safety" title="${esc(`${safe.name}: ${safe.line} ${rule.title}: ${rule.source}`)}"`);
  const lanes = [["sent", d.labels.lanes.sent.split(",")[0]], ["waits", "Your Today"], ["paused", d.labels.lanes.paused]];
  // the Meal planner waits on the shelf until nutrition is on, then joins the specialists code picks from
  const planner = d.sp.meal_planner.status != "not_on_yet", shelf = (planner ? "" : n("meal_planner")) + (S.recoveryFlag ? "" : n("recovery"));
  return msgHTML(t) +
    `<div class="bp-band" data-band="before"><div class="bp-bl"><span>Checks first</span><span class="bp-rules">Your rules</span></div><div class="bp-row bp-r4">${safety}${["topics", "memory", "rule_finder"].map((s) => n(s)).join("")}</div></div>` +
    `<div class="bp-shell"><div class="bp-sh-h"><span class="bp-mono">LS</span><b>Your Brain</b><span class="bp-cap">Code picks one specialist per moment</span><span class="bp-kind${a}">${esc(kindTag(t, r))}</span></div>` +
    `<div class="bp-pills">${COACH.map((s) => n(s)).join("")}${planner ? n("meal_planner") : ""}</div><div class="bp-row2">${n("set_logger", { name: "Set logger" })}${S.recoveryFlag ? n("recovery", { on: 1 }) : ""}<span class="bp-cl">code rules for workouts</span></div></div>` +
    `<div class="bp-band" data-band="after"><div class="bp-bl"><span>Checks after</span><span class="bp-rules">Your rules</span></div><div class="bp-row bp-r3">${["checker", "confidence", "lane_gate"].map((s) => n(s)).join("")}</div></div>` +
    `<div class="bp-lanes">${lanes.map(([l, txt]) => `<div class="bp-bin" data-lane="${l}"${l == r.lane ? " data-hot" : ""}>${l == "waits" ? '<span class="bp-mono">LS</span>' : ""}<span>${esc(txt)}</span></div>`).join("")}</div>` +
    `<div class="bp-low"><div class="bp-learn"><span class="bp-bl">Learns from you</span><div class="bp-lrow"><div class="sc-node bp-priv" data-sp="code" data-kind="check" data-state="${end.code ? end.code[0] : "idle"}"><span class="sc-mx" aria-hidden="true"></span>${U.icon("eye-off")}<span class="sc-nm">Privacy</span><span class="sc-val" aria-hidden="true"></span></div>${n("learner")}${n("examiner")}</div></div>` +
    (shelf ? `<div class="bp-shelf"><span class="bp-bl">${esc(d.labels.status.not_on_yet)}</span><div class="bp-lrow">${shelf}</div></div>` : "") + `</div>` +
    `<aside class="bp-book"><span>Your method · <b>24</b> rules (sample)</span></aside>`;
}

/** The root's inner HTML: the playground with its first moment played. */
export function renderStatic(d, o) {
  const S = defaults(d), t = d.trace(FIRST), r = decide(t, S, d), u = o.id;
  // With attract, the engine plays this moment once: what it plays waits for it.
  const a = o.attract ? " sc-res" : "";
  const ord = SPECS[0][2], i0 = r.steps.findIndex((s) => isPick(d, s)), hl = o.heading === false && !o.labelledBy ? "h2" : "h3";
  const rows = r.steps.map((s, i) => (i == i0 ? picksRow(d, i) : "") + U.stepRow(d, t, s).replace('<li class="sc-step"', `<li class="sc-step" data-i="${i}"`)).join("");
  const html = (o.heading === false ? "" : `<div class="bp-head"><h2 id="${u}-h">${esc(COPY.h2)}</h2><p>${esc(COPY.lede)}</p></div>`) +
    `<p class="bp-banner">${esc(d.labels.long)}</p><div class="bp-grid"><div class="bp-pick">` +
    `<label class="bp-lab"><span>${esc(COPY.specialty)}</span><select data-spec>${SPECS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></label>` +
    `<div class="bp-chips" role="group" aria-label="${esc(COPY.moments)}">${ord.map((i) => chipHTML(d, d.trace("t" + i), S, "t" + i == FIRST)).join("")}</div>` +
    `<button type="button" class="bp-more" aria-expanded="false">${esc(COPY.more)}</button>` +
    `<form class="bp-free"><label class="sc-sr" for="${u}-text">${esc(COPY.placeholder)}</label><textarea id="${u}-text" rows="2" maxlength="140" placeholder="${esc(COPY.placeholder)}"></textarea><button class="bp-btn bp-btn-p">${esc(COPY.run)}</button></form>` +
    `<p class="bp-closest"></p><button type="button" class="bp-btn bp-all-b">${U.icon("layers")}<span>${esc(COPY.all)}</span></button></div>` +
    `<div class="bp-stage sc-stage"><div class="bp-top">${U.strip(d)}<button type="button" class="bp-pause" aria-pressed="false"><span data-label>${esc(COPY.pause)}</span><span class="bp-psz" aria-hidden="true">${esc(COPY.pause)}</span></button></div>` +
    `<div class="bp-diagram"${o.attract ? " data-attract" : ""}>${nodesHTML(d, S, t, r, a)}</div>` +
    `<div class="bp-logd"><button type="button" class="bp-tg" aria-expanded="false" aria-controls="${u}-log">${esc(COPY.steps)}</button><div class="bp-log" id="${u}-log"><${hl}>${esc(COPY.panel)}</${hl}><div class="bp-logs"><ol${o.attract ? ' class="sc-res"' : ""}>${rows}</ol></div></div></div>` +
    `<div class="bp-foot"><span>${esc(d.labels.rates)}</span><span>${esc(d.labels.speed)}</span><details class="bp-how"><summary>${esc(COPY.how)}</summary><p class="bp-hownote">${esc(d.labels.howWeCount)}</p></details></div></div>` +
    `<div class="bp-out" id="${u}-out" tabindex="-1"><div class="bp-res${a}">${resultHTML(d, t, r)}</div>` +
    `<div class="bp-change${a}"><p class="bp-chg-h">${esc(COPY.change)}</p><button type="button" class="bp-tg" aria-expanded="false" aria-controls="${u}-set">${esc(COPY.change)}</button>` +
    `<div class="bp-set" id="${u}-set"><div class="bp-ctls">${controlsHTML(d, t, S, u)}</div><button type="button" class="bp-btn bp-again">${esc(COPY.again)}</button></div></div>` +
    U.cta(o, "bp-btn bp-btn-p bp-cta") + `</div></div>`;
  // Until the engine plays, its controls are not pressable (it enables what it wires).
  return html.replace(/<(button|select|textarea|input)\b/g, "<$1 disabled");
}
