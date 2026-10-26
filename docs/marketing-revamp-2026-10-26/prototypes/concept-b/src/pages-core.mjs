// Home ("/") and Pricing ("/pricing"): built by the foundation; they set
// the visual and motion bar. Copy follows blueprint C1 and C15 (pending
// owner approval) and content.json for everything else.
import { esc, href, C, pageFor } from "./core.mjs";
import {
  icon, hl, eyebrow, sectionHead, band, ctaRow, primaryCta, secondaryLink, chip, statusChip, sampleLabel,
  estimateLabel, srcBadge, paymentsNote, val, aed, numberField, addressPreview, faq, statusPanel, statusStrip,
  phone, offerScreen, todayScreen, controlFlow, constraintList, statement, stairs, bandMeter, rateAxis,
  sessionMarks, takeHomeTile, walk, kamranPill, table,
} from "./components.mjs";

/* ===================================================================== */
/* HOME                                                                   */
/* ===================================================================== */
function home(ctx) {
  const page = ctx.page;
  const how = pageFor("/how-it-works").sections.find((s) => s.id === "steps").steps;
  const walkSteps = how.map((s, i) => {
    if (i === 1) return { title: "Teach your AI", body: s.body.replace("Teach your Brain", "Teach your AI") };
    if (i === 4) return { ...s, chip: statusChip("publish", "publishing") };
    if (i === 7) return { title: s.title, body: "Subscribers pay in AED and payouts reach your UAE bank. Your statement itemises costs.", chip: statusChip("payments", "subscriber payments") };
    return s;
  });
  const fe = C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS);
  const sc = fe.scenarios;
  const homeFaq = [
    { q: "Will my AI replace me?", a: page.faqs.find((f) => /replace/.test(f.q)).a },
    { q: "What happens when a subscriber reports pain?", a: page.faqs.find((f) => /pain/.test(f.q)).a },
    { q: "Does it cost anything to join?", a: page.faqs.find((f) => /cost anything/.test(f.q)).a },
    { q: "Will my followers pay?", a: pageFor("/faq").faqs.find((f) => f.q === "Will my followers pay?").a },
    { q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments are not on yet, and publishing waits for them. Today you can sign up, build your page and app, and teach and test your AI. We'll show it here when payments are on." },
    { q: "Do I need technical skills?", a: page.faqs.find((f) => /technical/.test(f.q)).a },
  ];

  /* 1. Hero: offer screen + "Your price, our share" tile. No earnings figure. */
  const hero = `<section class="hero" data-hero aria-labelledby="h1">
<div class="container hero-grid">
  <div class="hero-copy">
    ${eyebrow("For UAE personal trainers")}
    <h1 id="h1" class="sweep">${hl("Your AI trains subscribers beyond your hours.", "trains")}</h1>
    <p class="lede">Teach it your method. It coaches every subscriber daily, under your name, at your price.</p>
    ${ctaRow({ location: "hero", secondary: { label: "Try the demo", href: "/demo" } })}
  </div>
  <div class="hero-stage" data-wc-skip>
    <div class="stage">
      <div class="stage-phone">${phone({ body: offerScreen(199), url: "layla-strength.trainsyou.com", label: false, ariaLabel: "Sample offer page for Layla Strength, a sample trainer" })}</div>
      <div class="price-tile tile" data-vt="price-tile" data-vt-to="earnings-calculator.html">
        <div class="tile-head"><p class="eyebrow">Your price, our share</p></div>
        <div class="pricer" data-pricer data-min="199" data-max="999" data-step="10" data-calc-name="hero_price">
          <button class="pricer-btn" type="button" data-step="-1" aria-label="Lower your price by AED 10" aria-disabled="true">${icon("minus")}</button>
          <div class="pricer-out"><span class="flash" data-flash-tile>${val("AED 199", { cls: "fig", attrs: "data-pricer-out", w: "7ch", align: "center" })}</span><span class="per">your price, a month</span></div>
          <button class="pricer-btn" type="button" data-step="1" aria-label="Raise your price by AED 10">${icon("plus")}</button>
          <input type="hidden" data-sync="price" value="199" min="199" max="999">
          <span class="sr-only" aria-live="polite" data-live></span>
        </div>
        <p class="tile-copy">At ${val("AED 199", { showPrice: 0 })}, our share is 25% for your first 100 subscribers. We earn only when your subscribers pay.</p>
        ${stairs({ labels: ["First 100", "101–300", "301–1,000", "1,001+"] })}
        <div class="price-tile-foot">${statusChip("payments", "subscriber payments")}<a class="link" href="earnings-calculator.html" data-cta="hero-tile">Estimate my earnings${icon("arrow")}</a></div>
      </div>
      <div class="stage-label">${sampleLabel()}</div>
    </div>
  </div>
</div>
</section>`;

  /* 2. The mechanism, second. */
  const mechanism = band({
    id: "how", tone: "paper", labelledby: "how-h",
    inner: `${sectionHead({ eyebrow: "How it works", title: "Your method, coaching every day", id: "how-h", lede: "Your AI, we call it your Trainer Brain, learns how you coach." })}
<ol class="steps3 reveal" data-stagger>
  <li class="step3"><span class="fig step3-n">1</span><h3>You teach</h3><p>Rules, cases and an 8-answer quiz.</p><div class="step3-ui" data-wc-skip><span class="chip chip--ink">Your rule</span><span>Add 2.5 kg after two easy sessions.</span></div></li>
  <li class="step3"><span class="fig step3-n">2</span><h3>It coaches</h3><p>A dated plan every day, guided workouts, and changes as they train.</p><div class="step3-ui step3-ui--plan" data-wc-skip><span class="fig">TUE 14</span><span>Lower body A · 45 min</span>${icon("check")}</div></li>
  <li class="step3"><span class="fig step3-n">3</span><h3>You decide</h3><ul class="step3-lanes"><li><span class="chip chip--ok">Confident</span>applied</li><li><span class="chip chip--off">Unsure</span>to you</li><li><span class="chip chip--err">Pain</span>paused, to you</li></ul></li>
</ol>
<div class="walk-wrap reveal">${walk(walkSteps, { id: "hw", label: "The 8-step walkthrough" })}<p class="walk-more">${secondaryLink({ label: "See how it works", href: "/how-it-works" })}</p></div>`,
  });

  /* 3. An hour sells once (static, no motion). */
  const hour = band({
    id: "hours", labelledby: "hours-h",
    inner: `<div class="hour reveal">
  <div class="hour-copy">${eyebrow("Your hours")}<h2 id="hours-h">An hour sells once.</h2><p class="lede">Your method doesn't. Your AI coaches every subscriber, every day.</p></div>
  <div class="hour-one" data-wc-skip><div class="session-card"><span class="eyebrow eyebrow--plain"><i class="mark-one" aria-hidden="true"></i>1 session</span><span class="fig fig-band">AED 250</span><span class="fine">One hour, sold once</span></div><p class="fine hour-src">Sample price inside the published Dubai range of AED 70–350. ${srcBadge("heytrainer-dubai-2026")}</p></div>
  <div class="hour-many" data-wc-skip>${sessionMarks(92, "92 session marks: the hours at AED 250 it would take to match the sample take-home of AED 22,885 a month, shown below")}<p class="hour-cap"><b class="fig">92 sessions</b><span>a month, at AED 250, to match the sample below.</span></p><div class="chip-row">${statusChip("payments", "subscriber payments")}</div></div>
</div>`,
  });

  /* 5. Free to start. Your price. (status first, then any AED figure) */
  const economics = band({
    id: "price", tone: "wash", labelledby: "price-h", cls: "econ",
    inner: `${sectionHead({ eyebrow: "Pricing", title: "Free to start. Your price.", id: "price-h" })}
<div class="econ-status reveal">${statusPanel({ id: "status" })}</div>
<div class="econ-grid">
  <div class="econ-facts reveal">
    <ul class="facts">
      <li><span class="fig fact-k">01</span><span><b>Free to join and set up.</b></span></li>
      <li><span class="fig fact-k">02</span><span><b>You set the price in AED.</b></span></li>
      <li><span class="fig fact-k">03</span><span><b>Our share starts at 25% and falls to 10% as you grow.</b> Each rate applies only to its band.</span></li>
    </ul>
    <div class="econ-stairs" data-wc-skip>${stairs({ labels: ["First 100", "101–300", "301–1,000", "1,001+"] })}</div>
    <p class="econ-line">We earn only when your subscribers pay.</p>
    ${secondaryLink({ label: "Pricing in detail", href: "/pricing" })}
  </div>
  <div class="econ-tile reveal" data-wc-skip>${takeHomeTile({ subscribers: 150, price: 199, name: "takehome_home", title: "What you keep" })}</div>
</div>
<div class="econ-more">
  <div class="replaces card reveal" data-wc-skip>
    <h3>One place, not seven tools</h3>
    <ul class="replace-list" data-stagger>
      ${["Website builder", "Client app", "Meal-planning app", "Messaging app", "Spreadsheets"].map((t, i) => `<li style="--i:${i}"><span class="strike">${t}</span>${chip("Included", "ok")}</li>`).join("")}
      <li style="--i:5"><span>Booking tool</span>${statusChip("payments", "", { hideOn: false })}</li>
      <li style="--i:6"><span>Payments and invoicing</span>${statusChip("payments", "")}</li>
    </ul>
    <p class="fine">Once your page is live.</p>
  </div>
  <div class="claim card reveal"><h3>Claim your address</h3>${addressPreview({ id: "addr-home", location: "inline" })}</div>
</div>`,
  });

  /* 6. Follower calculator (block reported separately from the word budget). */
  const followers = band({
    id: "followers", tone: "paper", labelledby: "followers-h", cls: "fcalc-band",
    inner: `<div class="fcalc" data-calc="follower" data-calc-name="follower_home" data-wc-calc>
  <div class="fcalc-in reveal">
    ${eyebrow("Follower calculator")}<h2 id="followers-h">What are your followers worth?</h2>
    <p class="muted">${esc(page.sections.find((s) => s.id === "followers").body[0])}</p>
    <div class="fcalc-fields">
      ${numberField({ label: "Instagram followers", in: "followers", value: 7000, min: 0, max: 10000000, step: 100 })}
      ${numberField({ label: "Your monthly price", in: "price", value: 199, min: 1, max: 10000, suffix: "AED", sync: "price" })}
      ${numberField({ label: "Stories with your link each month", in: "stories", value: 8, min: 0, max: 60, help: "Two a week is 8 a month." })}
    </div>
  </div>
  <div class="fcalc-out card reveal" data-result>
    <div class="chip-row fcalc-labels">${estimateLabel()}${statusChip("payments", "subscriber payments")}</div>
    <p class="fcalc-head"><span class="chip chip--ink">Best case</span> Up to ${val(C.aed(sc.strong.revenueMonth12Minor), { out: "strong.revenue", cls: "fig" })} a month at your price, before platform commission</p>
    <div class="scen" role="list">
      ${[["cautious", "Cautious"], ["typical", "Typical"], ["strong", "Best case"]].map(([k, l]) => `<div class="scen-col${k === "strong" ? " scen-col--best" : ""}" role="listitem"><span class="scen-l">${l}</span>${val(C.aed(sc[k].revenueMonth12Minor), { out: k + ".revenue", cls: "fig scen-fig", w: "9ch" })}<span class="scen-u">a month at month&nbsp;12</span><span class="scen-a">${val(C.countLabel(sc[k].activeMonth12), { out: k + ".active" })} active subscribers</span></div>`).join("")}
    </div>
    <p class="fine">A best case for an engaged, growing audience, not a typical result. From published benchmarks and our stated assumptions. ${srcBadge("revenuecat-state-2026")}</p>
    <div class="cta-row">${primaryCta({ location: "calculator" })}${secondaryLink({ label: "How we calculate this", href: "/methodology" })}</div>
    <p class="sr-only" aria-live="polite" data-live></p>
  </div>
</div>`,
  });

  /* 4. You stay in charge. */
  const control = band({
    id: "control", labelledby: "control-h",
    inner: `<div class="split split--center control">
  <div class="reveal">${eyebrow("Control")}<h2 id="control-h">You stay in charge</h2>
    <p class="lede">"Waits for me" mode: every reply waits for you until you turn on automatic sending. That needs 20 cases and passing checks.</p>
    <h3 class="h4 never-h">Your AI never:</h3>
    ${constraintList({ label: "What your AI never does", items: ["Keeps pain, medical issues or red flags from you.", "Pretends to be you.", "Gives medical or clinical advice.", "Uses your teaching for anyone else."] })}
    ${secondaryLink({ label: "How your AI decides", href: "/trainer-brain" })}
  </div>
  <div class="control-ui reveal" data-wc-skip>${controlFlow()}<div class="control-label">${sampleLabel()}</div></div>
</div>`,
  });

  /* 3 (moved). What subscribers get, under your name. */
  const subscribers = band({
    id: "subscribers", tone: "paper", labelledby: "subs-h",
    inner: `<div class="split split--center subs">
  <div class="subs-visual reveal" data-wc-skip>
    ${phone({ body: todayScreen(), small: true, label: false, ariaLabel: "Sample subscriber app, Today screen" })}
    <div class="subs-side">
      <div class="app-icon"><span class="app-icon-tile" aria-hidden="true">LS</span><span>Layla Strength</span><span class="fine">Your app icon</span></div>
      <p class="addr-pill">${icon("lock")}<span>layla-strength.trainsyou.com</span></p>
      ${sampleLabel()}
    </div>
  </div>
  <div class="reveal">${eyebrow("Subscribers")}<h2 id="subs-h">What subscribers get, under your name</h2>
    <ul class="get-list">
      <li><b>A dated plan, every day</b>${chip("Included", "ok")}</li>
      <li><b>Guided workouts that work offline</b>${chip("Included", "ok")}</li>
      <li><b>Progress they can see</b>${chip("Included", "ok")}</li>
      <li><b>Nutrition: meal plans, grocery list, food diary</b>${chip("Optional tier", "line")}</li>
      <li><b>Voice-led sessions in your voice</b>${chip("Add-on", "line")}${statusChip("voice", "")}</li>
      <li><b>Your site, your app icon, your-name.trainsyou.com</b>${chip("Included", "ok")}</li>
    </ul>
    <p class="fine subs-live">Once your page is live. ${statusChip("publish", "publishing", { hideOn: true })}</p>
    ${secondaryLink({ label: "All features", href: "/features" })}
  </div>
</div>`,
  });

  /* 7. Honest proof. */
  const proof = band({
    id: "proof", labelledby: "proof-h",
    inner: `<div class="proof">
  <div class="founder reveal" data-wc-skip>
    <div class="founder-photo" aria-hidden="true"><span>Photo</span></div>
    <div><p class="eyebrow eyebrow--muted">Founder note</p><p class="founder-q">[Founder name, photo and a short note on why they built trainsyou. Owner to supply: decision 2.]</p><p class="fine">Shown only with the founder's own words. We never write one for them.</p></div>
  </div>
  <div class="reveal">${eyebrow("Proof")}<h2 id="proof-h">Proof you can check</h2>
    <p class="lede">We publish no testimonials, logos, ratings or counts we can't show. Check these instead:</p>
    <ul class="check-links">
      <li><a href="demo.html">Try the demo${icon("arrow")}</a></li>
      <li><a href="methodology.html">Every market figure sourced${icon("arrow")}</a></li>
      <li><a href="pricing.html#bands">The commission maths${icon("arrow")}</a></li>
      <li><a href="#status">What works today${icon("arrow")}</a></li>
    </ul>
  </div>
</div>`,
  });

  /* 8. FAQ by objection. */
  const faqBand = band({
    id: "faq", labelledby: "faq-h", cls: "band-rule",
    inner: `<div class="split faq-split">
  <div class="reveal">${eyebrow("Questions")}<h2 id="faq-h">Before you start</h2><div class="faq-kamran">${kamranPill({ location: "faq", inline: true })}</div></div>
  <div class="reveal">${faq(homeFaq, { idPrefix: "q" })}</div>
</div>`,
  });

  return {
    main: [hero, mechanism, hour, economics, followers, control, subscribers, proof, faqBand].join("\n"),
    closing: { secondary: { label: "Try the demo", href: "/demo" } },
    kamran: true,
  };
}

/* ===================================================================== */
/* PRICING                                                                */
/* ===================================================================== */
function pricing(ctx) {
  const page = ctx.page;
  const sec = (id) => page.sections.find((s) => s.id === id);
  const ex = C.compactEarnings(150, 199, 250);
  const b = ex.bands;
  const blend = (n) => C.pct1(C.compactEarnings(n, 199).effectiveCommissionPct);
  const priceFaq = [
    { q: "What does it cost to join?", a: page.faqs.find((f) => /cost anything/.test(f.q)).a },
    { q: "Who sets the price?", a: page.faqs.find((f) => /sets the/.test(f.q)).a },
    { q: "What will I pay?", a: page.faqs.find((f) => /What will I pay/.test(f.q)).a },
    { q: "How does commission work with different prices?", a: page.faqs.find((f) => /different prices/.test(f.q)).a },
    { q: "Who owns my subscribers' data, and what if I leave?", a: "Your method stays private to your workspace. You and your subscribers can download your data and request deletion from settings. [Portability wording: owner to confirm.]" },
    { q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments are not on yet, and publishing waits for them. Today you can sign up, build your page and app, and teach and test your AI. We'll show it here when payments are on." },
  ];

  const hero = `<section class="page-hero pricing-hero" data-hero aria-labelledby="h1">
<div class="container pricing-hero-grid">
  <div>
    ${eyebrow("Pricing")}
    <h1 id="h1" class="sweep">${hl("Free to join. You set the price.", "price")}</h1>
    <p class="lede">Nothing to pay upfront. We earn only when your subscribers pay, and our share falls as you grow.</p>
    <div class="cta-row cta-row--stack-sm">${primaryCta({ location: "hero" })}${secondaryLink({ label: "Estimate my earnings", href: "/earnings-calculator", location: "hero" })}</div>
    ${statusStrip()}
  </div>
  <div class="pricing-hero-card card card--raised" data-wc-skip>
    <div class="tile-head"><p class="eyebrow">Our share falls as you grow</p></div>
    ${stairs({ here: 0 })}
    <p class="fine">Each rate applies only to the subscribers in its band. Free to set up, nothing to pay upfront.</p>
  </div>
</div>
</section>`;

  const glance = band({
    id: "glance", labelledby: "glance-h", cls: "band-rule",
    inner: `${sectionHead({ eyebrow: "At a glance", title: "What's free, what we take", id: "glance-h" })}
<div class="cols-3 glance reveal" data-stagger>
  <div class="card glance-col"><p class="eyebrow eyebrow--plain">Free</p><h3>Everything to start</h3><ul class="tick-list">${["Joining", "Your site and app", "Teaching your AI", "A free trainsyou address"].map((t) => `<li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>${t}</span></li>`).join("")}</ul></div>
  <div class="card glance-col glance-col--take"><p class="eyebrow eyebrow--plain">What we take</p><h3>A share per paying subscriber</h3><p class="glance-rates fig">25 · 20 · 15 · 10%</p><ul class="tick-list"><li>${icon("info")}<span>Card processing is itemised on your statement. Rate: [owner to state, decision 3].</span></li></ul></div>
  <div class="card glance-col"><p class="eyebrow eyebrow--plain">Optional</p><h3>Only if you choose</h3><ul class="tick-list"><li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>Your own domain, price shown before you buy</span></li><li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>Add-ons, such as the voice coach ${statusChip("voice", "")}</span></li></ul></div>
</div>
<p class="glance-line reveal"><b>We earn only when your subscribers pay.</b></p>`,
  });

  const bandsSec = band({
    id: "bands", tone: "paper", labelledby: "bands-h",
    inner: `<div class="split">
  <div class="reveal">${sectionHead({ eyebrow: "Commission", title: "How our share falls", id: "bands-h", reveal: false, lede: sec("bands").note })}
    ${table({ caption: sec("bands").table.caption, columns: ["Paying subscribers", "Our share in that band"], rows: sec("bands").table.rows.map((r) => r.map((c) => String(c).replace(/(\d)-(\d)/g, "$1–$2"))), figCols: [1] })}
  </div>
  <div class="share-tool card card--raised reveal" data-calc="earnings" data-calc-name="share_slider" data-wc-skip>
    <div class="tile-head"><p class="eyebrow">Your blended rate</p>${chip("At your price", "line")}</div>
    <input type="hidden" data-in="price" data-sync="price" value="199">
    ${`<div class="range"><div class="range-top"><label for="share-n">Paying subscribers</label>${val("300", { out: "subscribers", cls: "fig", w: "5ch", align: "end" })}</div><input id="share-n" type="range" data-in="subscribers" min="1" max="1500" step="1" value="300" data-valuetext="{v} subscribers" aria-valuetext="300 subscribers"><div class="range-ends" aria-hidden="true"><span>1</span><span>1,500</span></div></div>`}
    <div class="share-quick" role="group" aria-label="Jump to a subscriber count">${[100, 300, 1000, 1500].map((n) => `<button type="button" class="chip chip--line chip--plain" data-share-n="${n}">${C.whole(n)} → ${blend(n)}</button>`).join("")}</div>
    <p class="share-read">Our share overall</p>
    ${rateAxis(C.compactEarnings(300, 199).effectiveCommissionPct)}
    <div class="share-bands">${bandMeter(300)}</div>
    <p class="fine">Reaching a new band lowers the rate for subscribers in that band only.</p>
    <p class="sr-only" aria-live="polite" data-live></p>
  </div>
</div>`,
  });

  const worked = band({
    id: "example", tone: "wash", labelledby: "example-h",
    inner: `${sectionHead({ eyebrow: "Worked example", title: "What you keep, in AED", id: "example-h", after: `<div class="chip-row">${statusChip("payments", "subscriber payments")}</div>`, row: true })}
<div class="split worked">
  <div class="reveal">
    ${statement({
      title: "Worked example", period: "150 subscribers at AED 199",
      rows: [
        { label: "150 × AED 199", value: C.aed(ex.subscriptionMonthlyMinor) },
        { label: "Our share: 100 × 25%", value: "−" + C.aed(b[0].commissionMinor), sub: true },
        { label: "Our share: 50 × 20%", value: "−" + C.aed(b[1].commissionMinor), sub: true },
        { label: "Commission in all", value: "−" + C.aed(ex.commissionMinor) },
      ],
      total: { label: "You keep, before card processing", value: C.aed(ex.beforeOtherCostsMinor) },
      note: `About ${ex.equivalentSessions} sessions at AED 250.`,
    })}
    ${paymentsNote()}
  </div>
  <div class="reveal">${takeHomeTile({ subscribers: 150, price: 199, name: "takehome_pricing", title: "Try your numbers" })}<p class="worked-more">${secondaryLink({ label: "Add nutrition, voice and sessions", href: "/earnings-calculator" })}</p></div>
</div>`,
  });

  const hours = band({
    id: "hours", labelledby: "hours-h",
    inner: `<div class="split split--center">
  <div class="reveal">${eyebrow("Your hours")}<h2 id="hours-h">${esc(sec("hours").heading)}</h2><p class="lede">${esc(sec("hours").body[1])}</p></div>
  <div class="anchors reveal" data-stagger>
    <div class="anchor card"><span class="anchor-l">One-to-one session in Dubai</span><span class="fig fig-band">AED 70–350</span><span class="fine">per hour, sold once ${srcBadge("heytrainer-dubai-2026")} ${srcBadge("embody-dubai-2025")}</span></div>
    <div class="anchor card"><span class="anchor-l">Online coaching in Dubai</span><span class="fig fig-band">AED 400–2,000</span><span class="fine">a month ${srcBadge("369mmafit-online-2026")}</span></div>
    <p class="fine anchors-note">${esc(sec("hours").note)}</p>
  </div>
</div>`,
  });

  const extras = band({
    id: "statement", tone: "paper", labelledby: "statement-h",
    inner: `<div class="split split--center">
  <div class="reveal">${eyebrow("Your statement")}<h2 id="statement-h">${esc(sec("statement").heading)}</h2>
    <ul class="tick-list extras">${["Card processing fees, at [rate: owner to state].", "Your own domain, if you choose one.", "Refunds and disputes.", "Any booking fee in your finance policy."].map((t) => `<li>${icon("info")}<span>${esc(t)}</span></li>`).join("")}</ul>
  </div>
  <div class="reveal" data-wc-skip>${statement({
    title: "Monthly statement", period: "Layla Strength · October",
    rows: [
      { label: "Subscriptions, 150 × AED 199", value: C.aed(ex.subscriptionMonthlyMinor) },
      { label: "Our share, by band", value: "−" + C.aed(ex.commissionMinor) },
      { label: "Card processing (itemised)", value: "[rate]", sub: true },
      { label: "Own domain (optional)", value: "AED 0", sub: true },
      { label: "Refunds and disputes", value: "AED 0", sub: true },
    ],
    total: { label: "You keep, before card processing", value: C.aed(ex.beforeOtherCostsMinor) },
    note: "Sample statement. Payouts are monthly, to a verified UAE IBAN, once payouts are on.",
  })}</div>
</div>`,
  });

  const billing = band({
    id: "billing", labelledby: "billing-h",
    inner: `<div class="cols-2 billing reveal" data-stagger>
  <div class="card card--flat"><h2 id="billing-h" class="h3">${esc(sec("billing").heading)}</h2><p class="muted">${esc(sec("billing").body[0])}</p><div class="chip-row"><span class="chip chip--line chip--plain">Monthly</span><span class="chip chip--line chip--plain">Upfront</span><span class="chip chip--line chip--plain">Free trial days</span><span class="chip chip--line chip--plain">Promotion codes</span></div></div>
  <div class="card card--flat"><h2 class="h3">${esc(sec("payouts").heading)}</h2><p class="muted">${esc(sec("payouts").body[0])}</p><div class="chip-row">${statusChip("payments", "payouts")}</div></div>
</div>`,
  });

  const status = band({
    id: "status-band", tone: "wash", labelledby: "status-h",
    inner: `${sectionHead({ eyebrow: "Status", title: "Live today, and not on yet", id: "status-h" })}<div class="reveal">${statusPanel({ id: "status" })}</div>`,
  });

  const faqBand = band({
    id: "faq", labelledby: "faq-h",
    inner: `<div class="split faq-split"><div class="reveal">${eyebrow("Questions")}<h2 id="faq-h">Pricing, answered</h2></div><div class="reveal">${faq(priceFaq, { idPrefix: "pq" })}</div></div>`,
  });

  return {
    main: [hero, glance, bandsSec, worked, hours, extras, billing, status, faqBand].join("\n"),
    closing: { secondary: { label: "Estimate my earnings", href: "/earnings-calculator" } },
  };
}

export const pages = { "/": home, "/pricing": pricing };
