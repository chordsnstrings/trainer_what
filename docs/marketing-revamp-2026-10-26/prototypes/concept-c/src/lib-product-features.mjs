// The 11 feature detail pages: per-page copy (section C5, pending owner
// approval) and annotated vignettes (Fig. 1 hero plate, Fig. 2 subscriber,
// Fig. 3 trainer). Sample trainer: Layla Strength. Real facts only.
import * as h from "./lib/components.mjs";
import { xv, inEl, appTop, tabbar, ph, win, kv, pinEl, plate, plain } from "./lib-product.mjs";

const { esc, each, icon, chip, statusChip, placeholder } = { ...h, placeholder: (t) => `<span class="placeholder">${h.esc(t)}</span>` };
const check = (s = 14) => icon("check", { size: s });
const lock = (s = 14) => icon("lock", { size: s });

/** Content bullets of a section, in plain words. */
const bl = (page, id) => (page.sections.find((s) => s.id === id)?.bullets || []).map(plain);
const st = (page, id) => page.sections.find((s) => s.id === id)?.steps || [];
const fq = (page, re) => {
  const f = page.faqs.find((x) => re.test(x.q));
  if (!f) throw new Error(`${page.path}: no FAQ matching ${re}`);
  return plain(f.a);
};
const PAIN_A = "The workout pauses and you are alerted. Pain, medical issues and red flags come to you by rules enforced in code, outside the AI, so no prompt or setting can switch them off.";
const DATA_A = "It is taught with your material: confirmed rules, cases, examples and corrections. Each version is checked against your test cases and can be rolled back. We don’t fine-tune a model on you, and your teaching stays private.";
const DATA_ON = "It runs on a frontier model, taught with your confirmed rules, cases, examples and corrections. Each version is checked against your test cases and can be rolled back. We don’t fine-tune a model on you; your teaching stays private.";

export function featureSpecs({ calc }) {
  const subsMinor = 150 * 19900;
  const commMinor = calc.projectedCommission(150, 19900);
  const AED = (m) => calc.aedWhole(m);

  return {
    // -----------------------------------------------------------------------
    "/features/ai-training-plans": (page) => ({
      mark: "plans",
      lede: "A dated plan for each subscriber, built from your rules. It adapts as they train and hands you what it isn’t sure about.",
      hero: {
        caption: "Today, after a confident change",
        html: plate({
          deviceHtml: ph(`${appTop()}
<p class="app-h">Today</p><p class="app-sub">Mon 27 Oct · Lower body A</p>
<div class="app-card">
  <p class="app-row pd-hl"><span>${pinEl("a")}Back squat 4 × 6<small class="pd-rest-s">120 s rest</small></span><b>${xv("60 kg", "62.5 kg")}</b></p>
  <p class="app-row"><span>Romanian deadlift 3 × 8</span><b>50 kg</b></p>
  <p class="app-row"><span>Walking lunge 3 × 10</span><b>16 kg</b></p>
</div>
${inEl(`<p class="app-note-k">Why this changed ${pinEl("b")}</p><p>Your last two squat sessions were easy, so today is 2.5 kg heavier.</p>`, { cls: "app-note", delay: 260 })}
<div class="app-btn">Start guided session</div>
${tabbar("Plan")}`, { label: "Sample subscriber app: today’s plan, where back squat changes from 60 to 62.5 kg with the reason shown" }),
          notes: [["a", "Changed by your rule: two easy sessions, add 2.5 kg"], ["b", "The reason, in plain words"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "Your AI (we call it your Trainer Brain) follows your confirmed rules. Anything it isn’t sure enough about comes to you as a draft.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "The week ahead, with dates",
        fig: ph(`${appTop()}
<p class="app-h">This week</p>
<div class="pd-days">
  <p class="pd-day is-done"><span>Mon 27</span><b>Lower body A</b><i>${check(12)}</i></p>
  <p class="pd-day"><span>Wed 29</span><b>Upper body A</b><i></i></p>
  <p class="pd-day is-review"><span>Fri 31</span><b>Lower body B</b><i class="pd-dot"></i></p>
  <p class="pd-day is-rest"><span>Sat 1</span><b>Rest</b><i></i></p>
</div>
<div class="app-note"><p class="app-note-k">Friday</p><p>Layla is reviewing a change to this session. You’ll see it here.</p></div>
${tabbar("Plan")}`, { label: "Sample week view with dated sessions and a note that the trainer is reviewing Friday" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "What runs automatically",
        fig: win("Automatic changes · Layla Strength", `
<div class="pd-toggles">
  <p class="pd-tg is-on"><span>Progressions</span><b>Automatic</b><i></i></p>
  <p class="pd-tg is-on"><span>Missed sessions</span><b>Automatic</b><i></i></p>
  <p class="pd-tg"><span>Exercise swaps</span><b>Ask me first</b><i></i></p>
</div>
<div class="pd-sure"><p class="pd-kv"><span>How sure it must be</span><b>85%</b></p><span class="meter" style="--v:.85"><i></i></span></div>
<p class="pd-fine">Below 85%, a draft comes to you.</p>`, { label: "Sample settings: progressions and missed sessions automatic, swaps ask first, 85% required" }),
      },
      runs: { title: "How a plan runs, week by week", steps: st(page, "practice") },
      faqs: [
        { q: "Does my AI explain its changes?", a: fq(page, /explain/) },
        { q: "Can I still write programmes myself?", a: "Yes. Build programme templates with the exercise library, assign them and adjust any session. Your AI works alongside you." },
        { q: "Is my AI trained on my data?", a: DATA_A, aOn: DATA_ON },
        { q: "What happens when a subscriber reports pain?", a: PAIN_A },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/subscriber-app": (page) => ({
      mark: "your name",
      lede: "Subscribers get an app with your name, colours and icon. It guides them day by day and keeps working offline in the gym.",
      hero: {
        caption: "Added to the home screen",
        rtl: true,
        html: plate({
          deviceHtml: ph(`${appTop()}
<div class="pd-xb pd-install">
  <div class="pd-a pd-inst"><span class="app-icon pd-icon-lg">LS</span><p data-ar="إضافة Layla Strength إلى الشاشة الرئيسية">Add Layla Strength to your home screen</p><span class="btn-ui btn-ui--ink" data-ar="تثبيت التطبيق">Install the app</span>${pinEl("a")}</div>
  <div class="pd-b pd-inst pd-inst--done"><span class="app-icon pd-icon-lg">LS</span><p data-ar="Layla Strength على شاشتك الرئيسية">Layla Strength is on your home screen</p><span class="pd-ok">${check(14)}</span>${pinEl("a")}</div>
</div>
<p class="app-h" data-ar="اليوم">Today</p><p class="app-sub"><span data-ar="الأسبوع 3">Week 3</span> · Lower body A</p>
<div class="app-card">
  <p class="app-row"><span>Back squat 4 × 6</span><b data-ar="62.5 كغ">62.5 kg</b></p>
  <p class="app-row"><span>Romanian deadlift 3 × 8</span><b data-ar="50 كغ">50 kg</b></p>
</div>
<div class="app-btn" data-ar="بدء الجلسة">Start session</div>
<p class="app-offline"><span class="app-badge">${check(12)}<span data-ar="محفوظ على هذا الهاتف، وستتم مزامنته عند عودة الاتصال.">Saved on this phone. It syncs when you are back online.</span></span>${pinEl("b")}</p>
<div class="app-tabbar"><span class="on" data-ar="اليوم">Today</span><span data-ar="الخطة">Plan</span><span data-ar="التقدّم">Progress</span><span data-ar="المحادثة">Chat</span></div>`, { label: "Sample subscriber app for Layla Strength: add to home screen, today’s session, saved offline", rtl: true }),
          notes: [["a", "Your name and icon on their home screen"], ["b", "Saved on the phone; syncs when back online"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "No app store download. Subscribers add your app from their browser.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "A guided set, with rest",
        fig: ph(`<p class="pd-sess-k">Guided session · 2 of 3</p>
<p class="app-h">Back squat</p><p class="app-sub">Set 2 of 4 · target 6 reps at 62.5 kg</p>
<div class="pd-log">
  <p><span>Reps</span><b>6</b></p><p><span>Load</span><b>62.5 kg</b></p><p><span>In reserve</span><b>3</b></p>
</div>
<div class="pd-rest"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19"/><circle class="pd-rest-fill" cx="22" cy="22" r="19" pathLength="100"/></svg><p><b class="tnum">1:45</b><span>Rest</span></p></div>
<div class="app-btn">Log set</div>
<p class="pd-swap">Swap: Goblet squat · Leg press</p>
<p class="pd-pain">Report pain</p>`, { label: "Sample guided session: logging set 2 of back squat, a rest timer and approved swaps" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your app’s look, separate from your site",
        fig: win("Member app · appearance", `
<div class="pd-brand">
  <span class="app-icon pd-icon-xl">LS</span>
  <div><p class="pd-brand-n">Layla Strength</p><p class="pd-fine">Home-screen name and icon</p></div>
</div>
<p class="pd-sw-k">Colours</p>
<p class="pd-swatches"><span style="--c:#D5F24A"></span><span style="--c:#171917"></span><span style="--c:#F3F4F0"></span></p>
<p class="pd-sw-k">Approved swaps · Back squat</p>
<p class="pd-tags"><span>Goblet squat</span><span>Leg press</span><span class="pd-tag-add">+ Add</span></p>`, { label: "Sample member app appearance settings and approved swaps" }),
      },
      runs: { title: "A session, step by step", steps: st(page, "session") },
      faqs: [
        { q: "Do subscribers need to download anything?", a: fq(page, /download/) },
        { q: "Does it work without a connection?", a: "Yes. A workout opened online can be saved for offline use. Set logs stay on the phone and sync when the connection returns." },
        { q: "Is it available in Arabic?", a: "Core member screens work in English and Arabic, with right-to-left layouts. Coach-written content and this marketing site are not translated automatically." },
        { q: "Can subscribers see why their plan changed?", a: "Yes. When your AI changes a session, the subscriber sees the reason in plain words, and a note when you are reviewing a change yourself." },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/website-and-domain": (page) => ({
      mark: "your way",
      lede: "A desktop editor with 282 layouts in 40 section families. Drag sections into place, preview every screen, then publish at your address.",
      hero: {
        caption: "Dropping a section into place",
        html: plate({
          cls: "pd-plate--wide",
          deviceHtml: win("Website editor · desktop", `
<div class="pd-ed">
  <div class="pd-ed-rail">
    <p class="pd-sw-k">Sections ${pinEl("a")}</p>
    <p class="pd-fine">282 layouts in 40 families</p>
    <ul><li>Hero</li><li>Programmes</li><li>Pricing</li><li class="is-pick">Before and after</li><li>FAQ</li><li>Contact form</li></ul>
  </div>
  <div class="pd-ed-canvas">
    <p class="pd-ed-nav"><b>Home</b><span>Coaching</span><span>Results</span><span>Contact</span></p>
    <div class="pd-ed-block pd-ed-hero"><p class="pd-ed-t">Strength coaching, planned for you</p><span class="btn-ui btn-ui--ink">Join</span></div>
    <div class="pd-ed-block"><p class="pd-ed-k">Programmes</p><p class="pd-ed-cols"><span></span><span></span><span></span></p></div>
    <div class="pd-ed-drop">${inEl(`<p class="pd-ed-k">Before and after</p><p class="pd-ed-pair"><span>Before</span><span>After</span></p>`, { cls: "pd-ed-block pd-ed-new" })}</div>
  </div>
</div>
<p class="pd-ed-foot"><span>layla-strength.trainsyou.com</span><span>Own domain: price shown before you buy ${pinEl("b")}</span></p>`, { label: "Sample desktop website editor: a before-and-after section is dropped into the page" }),
          notes: [["a", "Desktop-only editor, with phone and tablet previews"], ["b", "Domain price shown before you buy"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "Real client photos only, with permission. AI picks modules; it never invents results.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "Your published site on a phone",
        fig: ph(`<p class="pd-url">${lock(11)}layla-strength.trainsyou.com</p>
<p class="pd-site-k">Layla Strength</p>
<p class="pd-site-h">Strength coaching, planned for you</p>
<div class="app-btn">See coaching plans</div>
<div class="pd-site-pair"><span>Before</span><span>After</span></div>
<p class="pd-fine">Client photos shared with permission.</p>
<div class="pd-site-row"><b>Training plan</b><span>Day by day, in the app</span></div>
<div class="pd-site-row"><b>Contact</b><span>Messages reach Layla’s inbox</span></div>`, { label: "Sample published coaching website on a phone" }),
      },
      control: {
        bullets: bl(page, "control").slice(0, 4),
        caption: "Publication history",
        fig: win("Publication history", `
<div class="pd-hist">
  <p class="is-live"><b>Version 5</b><span>24 Oct · live</span><em>Live</em></p>
  <p><b>Version 4</b><span>20 Oct</span><span class="btn-ui">Restore to draft</span></p>
  <p><b>Version 3</b><span>16 Oct</span><span class="btn-ui">Restore to draft</span></p>
</div>
<p class="pd-fine">Draft autosaved · Undo · Redo. Restoring doesn’t change the live site until you publish.</p>`, { label: "Sample publication history with restore to draft" }),
      },
      runs: {
        title: "From starter to published site",
        steps: [
          { title: "Choose a starter", body: "Pick a template, or describe your coaching and let AI assemble a starter from existing modules." },
          { title: "Make it yours", body: "Drag sections, edit copy and media, add pages and reuse sections." },
          { title: "Preview each screen", body: "Edit on desktop; preview desktop, tablet and phone before publishing." },
          { title: "Publish deliberately", html: `Publishing updates your public site once its launch checks pass. ${statusChip("publish", "Not on yet", "Live today")}` },
          { title: "Keep improving", body: "Undo and redo while editing. Restore a past version to a draft, then republish." },
          { title: "Choose your address", body: "Use your reserved address, or connect or buy your own domain." },
        ],
      },
      faqs: [
        { q: "Can I build the website on my phone?", a: "The editor is desktop-only. Your published website works on phones and tablets, and the editor previews every screen. Your member app has its own styling." },
        { q: "Can I use my own domain?", a: "Yes. Connect a domain you own, or let us buy and renew one for you. The price shows before you buy and on your statement." },
        { q: "Can I show before-and-after transformations?", a: plain(fq(page, /before-and-after/)) },
        { q: "Can I preview and recover changes?", a: "Yes. Drafts autosave, the editor has undo and redo, and previews stay private. Restore a past version to a draft; the live site changes only when you publish." },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/nutrition": (page) => ({
      mark: "your guidance",
      lede: "An optional, higher-priced tier. Meal plans, recipes and grocery lists follow what you teach; subscribers log meals by photo or barcode.",
      hero: {
        caption: "A meal photo, confirmed",
        html: plate({
          deviceHtml: ph(`${appTop()}
<p class="app-h">This week’s meals</p>
<p class="pd-week"><span>M</span><span class="on">T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></p>
<div class="app-card pd-meals">
  <p class="app-row"><span>Oats, yoghurt, berries</span><b>420 kcal</b></p>
  <p class="app-row"><span>Chicken shawarma bowl</span><b>610 kcal</b></p>
  <p class="app-row"><span>Salmon, rice, greens</span><b>580 kcal</b></p>
</div>
<div class="pd-photo">
  <span class="pd-photo-img" aria-hidden="true"></span>
  <div><p class="pd-sw-k">Photo estimate ${pinEl("a")}</p><p>Grilled chicken ~150 g · rice ~180 g</p>
  <p class="pd-photo-s">${xv(`<span class="pd-est">Estimate · tap to confirm</span>`, `<span class="pd-conf">${check(12)}Confirmed and logged</span>`)}</p></div>
</div>
<p class="pd-fine">Swaps you allow ${pinEl("b")}</p>
${tabbar("Food")}`, { label: "Sample nutrition week with a meal photo estimate that the subscriber confirms" }),
          notes: [["a", "Nothing is logged until they confirm it"], ["b", "Recipes and swaps follow your teaching"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "An optional tier on top of training. It can’t be bought alone.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "One grocery list for the week",
        fig: ph(`${appTop()}
<p class="app-h">Groceries</p><p class="app-sub">Week 3 · uses what’s in your pantry</p>
<ul class="pd-groc">
  <li class="is-got"><i>${check(11)}</i>Chicken breast<b>1.2 kg</b></li>
  <li class="is-got"><i>${check(11)}</i>Basmati rice<b>1 kg</b></li>
  <li><i></i>Greek yoghurt<b>1 kg</b></li>
  <li><i></i>Salmon fillets<b>4</b></li>
  <li><i></i>Mixed berries<b>500 g</b></li>
  <li class="is-pantry"><i></i>Oats<b>in pantry</b></li>
</ul>
${tabbar("Food")}`, { label: "Sample consolidated grocery list for the week" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your exceptions queue",
        fig: win("Nutrition · exceptions", `
<p class="pd-kv"><span>Calorie target</span><b>2,100 kcal · set by you</b></p>
<div class="pd-exc">
  <p class="pd-sw-k">Outside your rules</p>
  <p class="pd-exc-q">“Can I drop to 1,200 kcal before a photo shoot?”</p>
  <p class="pd-fine">Below the floor you taught. Comes to you, not your AI.</p>
  <p class="pd-btns"><span class="btn-ui btn-ui--ink">Reply</span><span class="btn-ui">Edit plan</span></p>
</div>`, { label: "Sample nutrition exceptions queue with a request outside the trainer’s rules" }),
      },
      runs: { title: "How a nutrition week works", steps: st(page, "week") },
      faqs: [
        { q: "Does nutrition cost the subscriber more?", a: fq(page, /cost the subscriber/) },
        { q: "Can subscribers choose nutrition only?", a: fq(page, /nutrition only/) },
        { q: "Is this medical nutrition advice?", a: fq(page, /medical/) },
        { q: "Can I edit a subscriber’s meal plan?", a: fq(page, /edit a subscriber/) },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/voice-coach": (page) => ({
      mark: "Your voice",
      lede: "Guided workouts in your verified voice and coaching style. Your consent comes first, and you can withdraw it.",
      hero: {
        caption: "A voice-led set, then rest",
        html: plate({
          deviceHtml: ph(`<p class="pd-sess-k">Voice-led session</p>
<p class="app-h">Back squat</p><p class="app-sub">Layla Strength · your verified voice ${pinEl("a")}</p>
<div class="pd-wave" aria-hidden="true">${each([5, 9, 14, 8, 17, 11, 6, 13, 19, 10, 7, 15, 12, 6, 9, 16, 8, 12, 5, 10, 14, 7], (v, i) => `<i style="--v:${v};--i:${i}"></i>`)}</div>
<div class="pd-cue pd-xb">
  <p class="pd-a">“Set 2 of 4. Six reps at 62.5 kg. Brace, then sit back.”</p>
  <p class="pd-b">“Good set. Rest 90 seconds, breathe, then go again.”</p>
</div>
<p class="pd-gen">Generated from Layla’s voice</p>
<div class="pd-ctrls"><span class="pd-ctrl">${icon("pause", { size: 16 })}</span><span class="pd-ctrl pd-ctrl--txt">Report pain</span></div>
<p class="pd-music">Own-music mode: short cues ${pinEl("b")}</p>
<p class="pd-set-bar" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i><i></i></p>
<div class="pd-next-up"><span class="pd-sw-k">Up next</span><b>Romanian deadlift 3 × 8 · 50 kg</b></div>`, { label: "Sample voice-led session: a cue for set 2, then a rest cue, disclosed as generated" }),
          notes: [["a", "Your verified voice · consent can be withdrawn"], ["b", "Short cues over their own music"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: `${statusChip("voice", "Not on yet for subscribers", "Live for subscribers")}<br>You can set it up and preview it today.`,
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "Always disclosed",
        fig: ph(`${appTop()}
<div class="pd-disc"><p class="pd-sw-k">Voice guidance</p><p>This voice is generated from your coach’s voice, with their consent.</p></div>
<p class="app-h">Lower body A</p><p class="app-sub">6 exercises · about 50 min</p>
<div class="app-btn">Start voice-led session</div>
<p class="pd-fine">Pause and Report pain work the same as every workout.</p>
${tabbar("Plan")}`, { label: "Sample disclosure shown before a voice-led session" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your voice, your consent",
        fig: win("Voice add-on", `
<p class="pd-kv"><span>Identity</span><b class="pd-ok-t">${check(13)}Verified</b></p>
<p class="pd-kv"><span>Your consent</span><b>Recorded 12 Oct · <u>Withdraw</u></b></p>
<p class="pd-kv"><span>Narration style</span><b>Plan first, short cues, calm close</b></p>
<p class="pd-kv"><span>Add-on price</span><b>Your price</b></p>
<p class="pd-fine">Used only for your own subscribers who add it.</p>`, { label: "Sample voice add-on settings: verified identity, recorded consent with withdraw" }),
      },
      runs: { title: "How the voice add-on works", steps: st(page, "how") },
      faqs: [
        { q: "Who can hear my voice?", a: fq(page, /Who can hear/) },
        { q: "Can I withdraw my voice later?", a: fq(page, /withdraw/) },
        { q: "Is the voice disclosed?", a: fq(page, /disclosed/) },
        { q: "Can members play their own music?", a: "Yes. Own-music mode uses short cues and tap-to-talk while members play their own music app. It doesn’t supply or control their music." },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/bookings": (page) => ({
      mark: "paid sessions",
      h1Chip: statusChip("payments", "Not on yet", "Live today"),
      lede: "Sell one-to-one sessions next to your AI coaching. Your cancellation rules decide refunds, and bookings land in their calendar.",
      hero: {
        caption: "Picking a slot",
        chip: statusChip("payments", "Not on yet: paid bookings", "Paid bookings live"),
        html: plate({
          deviceHtml: ph(`${appTop()}
<p class="app-h">Book a session</p><p class="app-sub">One-to-one with Layla · Studio, Dubai Marina</p>
<p class="pd-price tnum">AED 250 <small>a session</small>${pinEl("a")}</p>
<ul class="pd-slots">
  <li class="pd-slot"><b>Tue 28 Oct · 07:00</b><span>2 of 4 left</span></li>
  <li class="pd-slot pd-slot--pick"><b>Tue 28 Oct · 18:30</b><span>1 of 4 left</span><i class="pd-slot-on" aria-hidden="true">${check(13)}</i></li>
  <li class="pd-slot is-full"><b>Thu 30 Oct · 07:00</b><span>Full</span></li>
</ul>
<p class="pd-fine">Cancel up to 24 h before for a refund ${pinEl("b")}</p>
<div class="app-btn">${xv("Choose a time", "Reserve · AED 250")}</div>
${tabbar("Plan")}`, { label: "Sample booking screen: one-to-one sessions at AED 250, a slot is selected" }),
          notes: [["a", "Your price, capacity and place"], ["b", "Your cancellation window decides refunds"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "Free sessions work today. Paid sessions wait for subscriber payments.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "Their booking, with a reminder",
        fig: ph(`${appTop()}
<p class="app-h">My bookings</p>
<div class="pd-bk">
  <p class="pd-sw-k">Upcoming</p>
  <p class="pd-bk-t">Tue 28 Oct · 18:30</p>
  <p class="app-sub">One-to-one · Studio, Dubai Marina</p>
  <p class="pd-fine">Reminder the day before · free cancellation until 18:30 Mon</p>
  <span class="btn-ui">Add to calendar</span>
</div>
${tabbar("Plan")}`, { label: "Sample upcoming booking with reminder and add to calendar" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your weekly slots and policy",
        fig: win("Sessions · weekly", `
<table class="pd-mini-tbl"><thead><tr><th>Slot</th><th>Places</th><th>Price</th></tr></thead><tbody>
<tr><td>Tue 07:00</td><td>4</td><td>AED 250</td></tr><tr><td>Tue 18:30</td><td>4</td><td>AED 250</td></tr><tr><td>Sat 09:00</td><td>8</td><td>Free</td></tr></tbody></table>
<p class="pd-kv"><span>Cancellation window</span><b>24 hours</b></p>
<p class="pd-btns"><span class="btn-ui">Mark attended</span><span class="btn-ui">No-show</span></p>`, { label: "Sample weekly session slots with capacity, price and cancellation window" }),
      },
      runs: { title: "How bookings work", steps: st(page, "how") },
      faqs: [
        { q: "Can I run free sessions too?", a: fq(page, /free sessions/) },
        { q: "What happens when a subscriber doesn’t show up?", a: fq(page, /does not show/) },
        { q: "Where do sessions take place?", a: fq(page, /Where do sessions/) },
        { q: "Can subscribers book paid sessions today?", a: "Not yet. Paid bookings wait for subscriber payments, which are not on yet. You can set up slots and free sessions now." },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/chat-and-digital-coach": (page) => ({
      mark: "Stay close",
      lede: "Subscribers message you privately or ask a labelled digital coach that answers from your teaching. You can take over any time.",
      hero: {
        caption: "You take over",
        html: plate({
          deviceHtml: ph(`${appTop("Coach chat")}
<div class="pd-chat">
  <p class="bubble bubble--out">Can I swap lunges for split squats? Knee feels fine.</p>
  <p class="pd-who">Digital coach · from Layla’s rules ${pinEl("a")}</p>
  <p class="bubble bubble--in">Yes. Split squats are one of Layla’s approved swaps. Same sets and reps.</p>
  <p class="bubble bubble--out pd-att">${icon("share", { size: 13 })}photo · squat depth</p>
  ${inEl(`<p class="pd-takeover">Layla took over · digital coach paused ${pinEl("b")}</p>`, { delay: 0 })}
  ${inEl(`<p class="pd-who">Layla</p><p class="bubble bubble--in">Great depth. Keep the bar over mid-foot.</p>`, { delay: 320 })}
</div>
${tabbar("Chat")}`, { label: "Sample chat: the labelled digital coach answers, then the trainer takes over" }),
          notes: [["a", "Digital replies are always labelled"], ["b", "Your takeover pauses it for this subscriber"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "The digital coach answers from your AI (we call it your Trainer Brain). It never guesses: anything outside your teaching comes to you.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "Who is replying, always clear",
        fig: ph(`${appTop("Coach chat")}
<div class="pd-chat">
  <p class="pd-who">Digital coach</p><p class="bubble bubble--in">Your Friday session is unchanged. Rest well tonight.</p>
  <p class="pd-notice">Layla is replying personally</p>
  <p class="pd-who">Layla</p><p class="bubble bubble--in">Saw your note about sleep. Let’s keep Friday light.</p>
</div>
${tabbar("Chat")}`, { label: "Sample chat with labelled digital coach and personal replies" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your inbox",
        fig: win("Inbox · Layla Strength", `
<ul class="pd-inbox">
  <li><b>Noor</b><span>Hotel gym for two weeks</span><em class="pd-st pd-st--you">To you</em></li>
  <li><b>Omar</b><span>Swap question answered</span><em class="pd-st pd-st--ok">Digital coach</em></li>
  <li><b>Mia</b><span>You took over</span><em class="pd-st">Hand back</em></li>
</ul>`, { label: "Sample inbox: one thread handed to the trainer, one answered by the digital coach, one taken over" }),
      },
      runs: { title: "How a conversation flows", steps: st(page, "flow") },
      faqs: [
        { q: "Will subscribers think the digital coach is me?", a: fq(page, /think the digital/) },
        { q: "What if the digital coach doesn’t know?", a: fq(page, /does not know/) },
        { q: "Can messages include photos?", a: fq(page, /photos/) },
        { q: "What happens when a subscriber reports pain?", a: PAIN_A },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/progress-and-client-twin": (page) => ({
      mark: "one view",
      lede: "The Client Twin keeps what a subscriber told you, logged and shared, each with its date and source. Unknowns stay unknown.",
      hero: {
        caption: "A gap filled, with its source",
        html: plate({
          cls: "pd-plate--wide",
          deviceHtml: win("Client Twin · sample subscriber", `
<table class="pd-twin"><thead><tr><th>Field</th><th>Value</th><th>Source ${pinEl("a")}</th></tr></thead><tbody>
<tr><td>Goal</td><td>Squat body weight by March</td><td>Intake · 3 Oct</td></tr>
<tr><td>Schedule</td><td>3 days a week</td><td>Intake · 3 Oct</td></tr>
<tr><td>Equipment</td><td>Full gym</td><td>Edited by them · 18 Oct</td></tr>
<tr><td>Best squat</td><td>62.5 kg × 6</td><td>Logged · 20 Oct</td></tr>
<tr class="pd-hl"><td>Resting heart rate</td><td>${xv(`<span class="pd-unk">unknown ${pinEl("b")}</span>`, "58 bpm")}</td><td>${xv("—", "Apple Health import · 24 Oct")}</td></tr>
<tr><td>Sleep</td><td><span class="pd-unk">unknown</span></td><td>—</td></tr>
</tbody></table>`, { label: "Sample Client Twin: each field has a value, a date and a source; unknown fields say unknown" }),
          notes: [["a", "Every field has a date and a source"], ["b", "Missing? It says unknown. It never guesses"]],
        }),
      },
      // "Not on yet" replaces the bare "when enabled" (research principle 6).
      does: bl(page, "does").slice(0, 5).map((b) => b.replace("WHOOP and Zepp connect when enabled.", "WHOOP connects with permission; Zepp is not on yet.")),
      doesNote: `Apple Health import and WHOOP work today. Amazfit / Zepp: ${chip("noton", "Not on yet")}`,
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "Their progress page",
        fig: ph(`${appTop()}
<p class="app-h">Progress</p>
<div class="pd-stats"><p><b>11</b><span>sessions</span></p><p><b>62.5</b><span>kg best squat</span></p></div>
<div class="pd-bars" aria-hidden="true">${each([0.42, 0.55, 0.5, 0.68, 0.74, 0.7, 0.86, 0.92], (v, i) => `<i style="--v:${v};--i:${i}"></i>`)}</div>
<p class="pd-fine">Weekly training volume</p>
<div class="app-card"><p class="app-row"><span>Back squat</span><b>62.5 kg</b></p><p class="app-row"><span>Romanian deadlift</span><b>55 kg</b></p></div>
${tabbar("Progress")}`, { label: "Sample progress page: sessions, best loads and weekly volume" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your wearable policy",
        fig: win("Wearables · your policy", `
<p class="pd-kv"><span>Apple Health import</span><b class="pd-ok-t">${check(13)}Works today</b></p>
<p class="pd-kv"><span>WHOOP</span><b class="pd-ok-t">${check(13)}With permission</b></p>
<p class="pd-kv"><span>Amazfit / Zepp</span><b>${chip("noton", "Not on yet")}</b></p>
<p class="pd-kv"><span>Use shared data in coaching</span><b>Only with consent</b></p>`, { label: "Sample wearable policy: Apple Health and WHOOP, Zepp not on yet, used only with consent" }),
      },
      runs: {
        title: "What the Client Twin holds",
        table: {
          caption: "Each entry keeps its source",
          columns: ["Context", "Where it comes from", "Who can edit it"],
          rows: [
            ["Goals and schedule", "Intake, with the date given", "The subscriber"],
            ["Coaching preferences", "The subscriber", "The subscriber"],
            ["Training history", "Logged sessions", "Corrections kept in history"],
            ["Wearable data", "Only what they chose to share", "Their sharing choices"],
            ["Anything missing", "Marked unknown, never guessed", "Filled at a check-in"],
          ],
        },
      },
      faqs: [
        { q: "Where does progress data come from?", a: fq(page, /Where does progress/) },
        { q: "Can I see a subscriber’s Client Twin?", a: "Yes. You see the same coaching context your AI uses, including what is still unknown, so you can fill gaps at a check-in." },
        { q: "Can subscribers see their own progress?", a: fq(page, /their own progress/) },
        { q: "Which wearables are supported?", a: "Apple Health exports can be imported, and WHOOP connects with the subscriber’s permission. Amazfit / Zepp is not on yet." },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/payments-and-payouts": (page) => ({
      mark: "UAE bank",
      h1Chip: statusChip("payments", "Not on yet", "Live today"),
      lede: "Subscribers pay by card in AED. You set the length and billing, and get a monthly statement from gross to net.",
      statusStrip: true,
      hero: {
        caption: "A month, gross to net",
        chip: statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live"),
        html: plate({
          cls: "pd-plate--wide",
          deviceHtml: `<div class="stmt pd-stmt" role="img" aria-label="Sample monthly statement: 150 subscribers at AED 199, our share by band, payout to a UAE bank">
  <div class="stmt-head"><p class="stmt-t">Statement · October</p><span class="pd-stmt-s">${xv("Reconciling", `${check(13)}Payout scheduled · 1 Nov`)}</span></div>
  <dl class="stmt-lines">
    <div><dt>150 subscribers × AED 199</dt><dd class="tnum">${AED(subsMinor)}</dd></div>
    <div><dt>Our share, by band ${pinEl("a")}</dt><dd class="tnum">−${AED(commMinor)}</dd></div>
    <div><dt>Payment processing</dt><dd>${placeholder("itemised · decision 3")}</dd></div>
    <div class="pd-stmt-net"><dt>Before card processing</dt><dd class="tnum">${AED(subsMinor - commMinor)}</dd></div>
    <div><dt>Payout to UAE IBAN ···· 4410 ${pinEl("b")}</dt><dd>monthly</dd></div>
  </dl>
</div>`,
          notes: [["a", "25% on the first 100, 20% on the next 50"], ["b", "Only to a verified UAE IBAN"]],
        }),
      },
      does: bl(page, "does").slice(0, 5),
      doesNote: "A short hold applies after a bank account change, shown on your statement.",
      sees: {
        bullets: bl(page, "subscriber"),
        caption: "Your price and terms before they pay",
        fig: ph(`${appTop()}
<p class="app-h">Training plan</p><p class="app-sub">12 weeks · billed monthly</p>
<p class="pd-price tnum">AED 199 <small>a month</small></p>
<ul class="pd-terms"><li>${check(12)}Renews 1 Dec · stop renewal any time</li><li>${check(12)}Invoices and refunds in your account</li></ul>
<div class="app-btn">Pay by card</div>
<p class="pd-fine">Refunds are a separate request your coach decides.</p>`, { label: "Sample checkout: training plan at AED 199 a month with terms before paying" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Your offer settings",
        fig: win("Offer · Training plan", `
<p class="pd-kv"><span>Price</span><b>AED 199 a month</b></p>
<p class="pd-kv"><span>Length</span><b>12 weeks</b></p>
<p class="pd-seg"><span class="on">Monthly</span><span>Upfront</span></p>
<p class="pd-kv"><span>Free trial</span><b>7 days</b></p>
<p class="pd-kv"><span>Refund request</span><b class="pd-btns"><span class="btn-ui btn-ui--ink">Approve</span><span class="btn-ui">Decline</span></b></p>`, { label: "Sample offer settings: price, length, billing, trial and a refund request" }),
      },
      runs: {
        title: "What your statement shows",
        table: {
          caption: "Every cost on one monthly statement",
          columns: ["Line", "What it shows"],
          rows: [
            ["Subscription revenue", "Gross, in AED"],
            ["Our share", "25%, 20%, 15% and 10%, each for its own group of subscribers"],
            ["Payment processing", "Itemised (rate: owner to confirm, decision 3)"],
            ["Optional services", "Voice add-on, your own domain"],
            ["Refunds, disputes, holds", "Itemised, with dates"],
          ],
        },
      },
      faqs: [
        { q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments and payouts are not on yet, and publishing your page waits for them. Today you can sign up, set up your page and app, and teach and test your AI." },
        { q: "Which currency do subscribers pay in?", a: fq(page, /currency/) },
        { q: "When will I get paid?", a: "Once payouts are on: monthly, to your verified UAE bank account, after payments are reconciled. A newly changed bank account has a short hold for your protection." },
        { q: "Who sets the subscription price?", a: "You do: the monthly or upfront price in AED, the length, trials and promotions. Our share is 25%, 20%, 15% or 10%, each for its own group of subscribers." },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/safety": (page) => ({
      mark: "cannot override",
      lede: "Pain, medical issues and red flags come to you by rules enforced in code, outside the AI. The workout pauses until you review it.",
      hero: {
        caption: "One tap, workout paused",
        html: plate({
          deviceHtml: `<div class="pd-safety">${ph(`<p class="pd-sess-k">Guided session</p>
<p class="app-h">Back squat</p><p class="app-sub">Set 3 of 4 · 62.5 kg</p>
<div class="pd-log"><p><span>Reps</span><b>6</b></p><p><span>Load</span><b>62.5 kg</b></p></div>
<div class="pd-xb pd-pause">
  <div class="pd-a"><div class="app-btn">Log set</div><p class="pd-pain pd-pain--tap">Report pain ${pinEl("a")}</p></div>
  <div class="pd-b pd-paused"><p class="pd-paused-t">${icon("pause", { size: 16 })}Workout paused</p><p>Layla will review this with you. This is coaching, not medical advice.</p></div>
</div>
${tabbar("Plan")}`, { label: "Sample guided session: the subscriber taps Report pain and the workout pauses" })}
${inEl(`<div class="pd-alert"><p class="pd-sw-k">Safety hold ${pinEl("b")}</p><p class="pd-alert-t">Knee pain reported</p><p class="pd-fine">Back squat · set 3 · just now</p><span class="btn-ui btn-ui--ink">Review</span></div>`, { delay: 420 })}</div>`,
          notes: [["a", "One tap pauses the workout"], ["b", "You’re alerted straight away"]],
        }),
      },
      does: bl(page, "does"),
      doesNote: "You can add red flags. You can’t remove the safety rules.",
      sees: {
        bullets: bl(page, "subscriber").slice(0, 3),
        caption: "What they see while paused",
        fig: ph(`${appTop()}
<div class="pd-paused pd-paused--full"><p class="pd-paused-t">${icon("pause", { size: 16 })}Training paused</p><p>Layla is reviewing your knee report. You’ll get her decision here and by notification.</p></div>
<p class="pd-fine">This service is coaching, not medical advice. If pain is severe, seek medical care.</p>
<p class="pd-pain">Report pain</p>
${tabbar("Plan")}`, { label: "Sample paused screen telling the subscriber their trainer will review" }),
      },
      control: {
        bullets: bl(page, "control"),
        caption: "Red flags: add yours, keep ours",
        fig: win("Safety · red flags", `
<p class="pd-sw-k">Always on</p>
<p class="pd-tags pd-tags--lock"><span>${lock(12)}Pain</span><span>${lock(12)}Pregnancy</span><span>${lock(12)}Medical issues</span><span>${lock(12)}Red flags</span></p>
<p class="pd-sw-k">Yours</p>
<p class="pd-tags"><span>Recent surgery</span><span>Dizziness</span><span class="pd-tag-add">+ Add</span></p>
<p class="pd-fine">You can add red flags. You can’t remove the safety rules.</p>`, { label: "Sample red flags: built-in rules locked on, trainer additions editable" }),
      },
      runs: { title: "When a subscriber reports pain", steps: st(page, "pain") },
      faqs: [
        { q: "Does my AI decide whether pain is serious?", a: "No. Any pain report pauses training and comes to you; your AI doesn’t judge whether it is serious. You decide what happens next." },
        { q: "Can I add my own red flags?", a: fq(page, /own red flags/) },
        { q: "Can I switch safety routing off?", a: fq(page, /switch safety/) },
      ],
    }),

    // -----------------------------------------------------------------------
    "/features/team": (page) => {
      const R = [
        ["Your AI and teaching", 1, 1, 0],
        ["Subscribers and chat", 1, 1, 0],
        ["Programmes", 1, 1, 0],
        ["Earnings and payouts", 1, 0, 1],
        ["Design and brand", 1, 0, 0],
        ["Team and ownership", 1, 0, 0],
      ];
      const tick = (on, c) => on ? `<span class="pd-tick" style="--c:${c}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" pathLength="1"/></svg><span class="sr-only">Yes</span></span>` : `<span class="pd-no">—<span class="sr-only">No</span></span>`;
      return {
        mark: "team",
        lede: "Invite staff coaches and finance members with restricted roles. You keep ownership of the brand and your AI.",
        hero: {
          caption: "Who can open what",
          html: plate({
            cls: "pd-plate--wide",
            deviceHtml: `<div class="pd-roles window"><div class="window-bar"><span class="window-title">Team · roles</span></div><div class="window-body"><table class="pd-rtbl"><caption class="sr-only">What each role can open</caption><thead><tr><th scope="col">Screen</th><th scope="col">Owner</th><th scope="col">Staff coach ${pinEl("a")}</th><th scope="col">Finance ${pinEl("b")}</th></tr></thead><tbody>${each(R, ([n, o, s, f]) => `<tr><th scope="row">${esc(n)}</th><td>${tick(o, 0)}</td><td>${tick(s, 1)}</td><td>${tick(f, 2)}</td></tr>`)}</tbody></table></div></div>`,
            notes: [["a", "Staff coach: no finance, design or ownership"], ["b", "Finance: no coaching data"]],
          }),
        },
        does: bl(page, "does"),
        doesNote: "Everyone signs in with their own account. Nobody shares a password.",
        sees: {
          bullets: bl(page, "subscriber"),
          caption: "One brand, whoever replies",
          fig: ph(`${appTop("Coach chat")}
<div class="pd-chat">
  <p class="pd-who">Omar · Layla Strength team</p><p class="bubble bubble--in">Your Thursday session is moved. See you then.</p>
  <p class="bubble bubble--out">Thanks!</p>
  <p class="pd-who">Digital coach</p><p class="bubble bubble--in">Thursday is now Lower body B. Rest on Friday.</p>
</div>
${tabbar("Chat")}`, { label: "Sample chat where a staff coach and the labelled digital coach reply under one brand" }),
        },
        control: {
          bullets: bl(page, "control"),
          caption: "Invite with a role",
          fig: win("Team · Layla Strength", `
<ul class="pd-inbox pd-team">
  <li><b>Layla</b><span>Owner</span><em class="pd-st">You</em></li>
  <li><b>Omar</b><span>Staff coach</span><em class="pd-st">Change role</em></li>
  <li><b>Sara</b><span>Finance</span><em class="pd-st">Change role</em></li>
</ul>
<p class="pd-invite"><span>name@email.com</span><span>Staff coach</span><span class="btn-ui btn-ui--ink">Invite</span></p>
<p class="pd-fine">Every role change and removal is recorded.</p>`, { label: "Sample team list with roles and an invite by email" }),
        },
        runs: { title: "Adding someone to your team", steps: st(page, "invite") },
        faqs: [
          { q: "Can a finance member read subscribers’ messages?", a: fq(page, /finance member read/) },
          { q: "Can a staff coach see my earnings?", a: fq(page, /staff coach see/) },
          { q: "Who owns the brand and my AI?", a: "You, as the owner. Staff coaches work inside your method but can’t change ownership, design or finance settings." },
          { q: "Does each team member need their own account?", a: fq(page, /own account/) },
        ],
      };
    },
  };
}
