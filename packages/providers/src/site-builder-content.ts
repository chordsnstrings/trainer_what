import { createModule, siteBuilderSchema, type SiteBuilderDocument, type SiteBuilderSection } from "../../contracts/src/site-builder.ts";
import type { SiteStarterInput } from "./site-builder-starter.ts";

/** A bounded public projection. No transcripts, private files or customer records. */
export type SiteStarterContent = {
  audience: string; city: string; trainingServices: string; deliveryMode: string;
  style?: string; motion?: "cinematic" | "subtle" | "still";
  photos: Array<{ mediaId: string; alt: string; role: "portrait" | "cover" | "training" }>;
  offers: Array<{ id: string; name: string; description: string; tier: string; premiumVoice: boolean }>;
};
const supported = new Set(["hero", "intro", "about", "split", "services", "benefits", "process", "programmes", "programme-detail", "pricing", "faq", "contact", "call-to-action", "scroll-journey", "scroll-image", "gallery", "text", "spacer"]);
const photoModules = new Set(["scroll-journey", "scroll-image", "gallery", "split"]);

/** Complete curated modules with approved facts; prices stay in native offer bindings. */
export function populateSiteStarter(builder: SiteBuilderDocument, input: SiteStarterInput): SiteBuilderDocument {
  if (!input.content) return builder;
  const data = input.content;
  const result = structuredClone(builder), ar = input.language === "ar";
  const words = (en: string, arabic: string) => ar ? arabic : en;
  const name = input.identity.name, bio = input.identity.bio;
  const description = data.trainingServices || bio;
  const photos = data.photos;
  const portrait = photos.find(p => p.role === "portrait") ?? photos[0];
  const cover = photos.find(p => p.role === "cover") ?? photos.find(p => p.role === "training") ?? portrait;
  const url = (photo: (typeof photos)[number] | undefined) => photo ? `/api/v1/media/${photo.mediaId}` : "";
  const delivery = ({ online: words("Online coaching", "تدريب عبر الإنترنت"), in_person: words("In-person coaching", "تدريب حضوري"), hybrid: words("Online and in-person coaching", "تدريب حضوري وعبر الإنترنت") } as Record<string, string>)[data.deliveryMode] ?? "";
  const items = (section: SiteBuilderSection, entries: Array<{ title: string; body: string }>) => entries.map((entry, i) => ({ id: `${section.id}-item-${i + 1}`, title: entry.title.slice(0, 160), body: entry.body.slice(0, 1200) }));
  const services = description.split(/\n|;/).map(s => s.trim()).filter(Boolean).slice(0, 6);
  const coreItems = services.map((text, i) => ({ title: services.length > 1 ? text.slice(0, 90) : input.identity.category || words("Your training", "تدريبك"), body: services.length > 1 && text.length <= 90 ? "" : text }));
  const faq = [
    { title: words("What training do you offer?", "ما التدريب الذي تقدمه؟"), body: description },
    ...(delivery ? [{ title: words("How does coaching take place?", "كيف يتم التدريب؟"), body: [delivery, data.city].filter(Boolean).join(" · ") }] : []),
    ...(data.audience ? [{ title: words("Who is this coaching for?", "لمن يناسب هذا التدريب؟"), body: data.audience }] : []),
    { title: words("How do I get started?", "كيف أبدأ؟"), body: words("Explore the coaching packages, or send a message using the contact form to discuss your goals.", "تصفح باقات التدريب أو أرسل رسالة عبر نموذج التواصل لمناقشة أهدافك.") },
  ];
  function fill(section: SiteBuilderSection) {
    const c = section.content, module = section.moduleId;
    c.eyebrow = c.eyebrow || input.identity.category;
    if (["hero", "intro"].includes(module)) {
      c.title = input.identity.headline || name;
      c.body = module === "hero" ? bio : description;
      c.image = url(cover); c.imageAlt = cover?.alt ?? "";
      if (!photos.length && module === "hero") section.variant = "centered";
    } else if (["about", "text"].includes(module)) {
      c.title = words(`Meet ${name}`, `تعرّف على ${name}`); c.body = bio;
      c.image = url(portrait); c.imageAlt = portrait?.alt ?? "";
    } else if (module === "split") {
      c.title = input.identity.category || words("How I coach", "طريقتي في التدريب"); c.body = description;
      c.image = url(cover); c.imageAlt = cover?.alt ?? "";
    } else if (["services", "benefits"].includes(module)) {
      c.title = words("Training built around you", "تدريب يناسبك"); c.body = data.audience;
      c.items = items(section, coreItems);
    } else if (module === "process") {
      c.title = words("Getting started", "خطوات البداية"); c.body = "";
      c.items = items(section, [
        { title: words("Explore your coaching", "اكتشف التدريب"), body: words("Review the packages and what is included.", "راجع الباقات وما تتضمنه.") },
        { title: words("Share your goals", "شارك أهدافك"), body: words("Tell your coach about your goals, experience and what works for your routine.", "أخبر مدربك بأهدافك وخبرتك وما يناسب روتينك.") },
        { title: words("Follow your plan", "اتبع خطتك"), body: words("Your coaching plan and its preparation status are available in your member area.", "تتوفر خطتك التدريبية وحالة إعدادها في حسابك.") },
      ]);
    } else if (["programmes", "programme-detail", "pricing"].includes(module)) {
      c.title = words("Your coaching options", "خيارات التدريب"); c.body = words("Explore the packages and what each one includes.", "تعرف على الباقات وما تتضمنه كل باقة.");
      c.productIds = data.offers.map(o => o.id); c.items = [];
    } else if (module === "faq") {
      c.title = words("Before you begin", "قبل أن تبدأ"); c.body = ""; c.items = items(section, faq);
    } else if (module === "contact") {
      c.title = words(`Talk to ${name}`, `تواصل مع ${name}`); c.body = words("Tell me what you want to work towards and ask anything about the coaching.", "أخبرني بما تريد تحقيقه واسأل عما ترغب بمعرفته عن التدريب.");
      c.items = [];
    } else if (module === "call-to-action") {
      c.title = words("Find your next step", "اختر خطوتك التالية"); c.body = data.audience;
      c.actions = [{ kind: "programmes", label: words("Explore coaching", "اكتشف التدريب"), newTab: false }];
      c.image = url(cover); c.imageAlt = cover?.alt ?? "";
    } else if (module === "gallery") {
      c.title = words("A look at my training", "نظرة على تدريبي"); c.body = "";
      delete c.galleryId;
      c.items = photos.map((photo, i) => ({ id: `${section.id}-photo-${i}`, title: "", body: "", image: url(photo), imageAlt: photo.alt, caption: photo.alt }));
    } else if (module === "scroll-image") {
      c.title = input.identity.headline || name; c.body = description;
      c.image = url(cover); c.imageAlt = cover?.alt ?? "";
    } else if (module === "scroll-journey") {
      c.title = words("Get to know my coaching", "تعرّف على تدريبي"); c.body = "";
      c.items = photos.map((photo, i) => ({ id: `${section.id}-scene-${i}`, title: photo.alt.slice(0, 160), body: photo.role === "portrait" ? bio.slice(0, 600) : (services[i % Math.max(1, services.length)] ?? description).slice(0, 600), image: url(photo), imageAlt: photo.alt, action: { kind: "programmes" as const, label: words("Explore coaching", "اكتشف التدريب"), newTab: false } }));
    }
    if (module.startsWith("scroll-")) section.scroll = { ...section.scroll, enabled: data.motion !== "still", pace: "balanced", intensity: data.motion === "subtle" ? "subtle" : "standard", navigation: true, mobile: "stacked", focusX: 50, focusY: 50 };
    return section;
  }
  for (const page of result.pages) {
    page.sections = page.sections.filter(s => supported.has(s.moduleId) && (photos.length || !photoModules.has(s.moduleId))).map(fill);
    if (!page.sections.length) page.sections = [fill(createModule("intro", "centered", {}, input.language))];
    page.seoTitle = `${page.title} · ${name}`.slice(0, 100);
    page.seoDescription = bio.slice(0, 200); page.socialImage = url(cover);
  }
  const home = result.pages.find(p => p.slug === "")!;
  if (!home.sections.some(s => s.moduleId === "hero")) home.sections.unshift(fill(createModule("hero", "centered", {}, input.language)));
  if (photos.length && data.motion !== "still" && !result.pages.some(p => p.sections.some(s => s.moduleId.startsWith("scroll-"))))
    home.sections.splice(Math.min(2, home.sections.length), 0, fill(createModule(photos.length > 1 ? "scroll-journey" : "scroll-image", photos.length > 1 ? "cinematic" : "zoom-in", {}, input.language)));
  for (const [family, variant] of [["programmes", "cards"], ["faq", "accordion"], ["contact", "centered"]] as const)
    if (!result.pages.some(p => p.sections.some(s => s.moduleId === family || family === "programmes" && s.moduleId === "pricing"))) home.sections.push(fill(createModule(family, variant, {}, input.language)));
  // Adding essential content must keep the same 10/page and 24/website budget
  // enforced on the model plan. Retain each page and each essential function.
  const all = result.pages.flatMap(p => p.sections);
  const keep = new Set(result.pages.map(p => p.sections[0].id));
  for (const families of [["hero"], ["scroll-image", "scroll-journey"], ["programmes", "pricing"], ["faq"], ["contact"]]) {
    const section = all.find(s => families.includes(s.moduleId));
    if (section) keep.add(section.id);
  }
  const removableIndex = (sections: SiteBuilderSection[]) => {
    for (let i = sections.length - 1; i >= 0; i--) if (!keep.has(sections[i].id)) return i;
    return -1;
  };
  for (const page of result.pages) while (page.sections.length > 10) {
    const removable = removableIndex(page.sections);
    if (removable < 0) break;
    page.sections.splice(removable, 1);
  }
  while (result.pages.reduce((n, p) => n + p.sections.length, 0) > 24) {
    const page = [...result.pages].reverse().find(p => p.sections.some(s => !keep.has(s.id)));
    if (!page) break;
    page.sections.splice(removableIndex(page.sections), 1);
  }
  result.footer.text = name;
  return siteBuilderSchema.parse(result);
}
