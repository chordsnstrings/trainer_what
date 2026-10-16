// Synthetic public answers for isolated browser checks only.
export const websiteFacts = {
  publicName: "Alex Rivers", city: "Dubai", specialty: "strength", audience: "busy beginners",
  trainingServices: "Strength sessions; kettlebell technique; mobility practice", deliveryMode: "hybrid",
  headline: "Build strength around your life", bio: "I coach busy beginners with practical strength sessions and steady progress.",
  name: "Everyday Strength", description: "Personal strength training with weekly check-ins", offerIncludes: "training",
  billing: "monthly", priceAed: 399, websiteStyle: "minimal", websiteMotion: "cinematic",
};
export const arabicWebsiteFacts = { ...websiteFacts, publicName: "أليكس ريفرز", audience: "المبتدئون أصحاب الجداول المزدحمة", headline: "ابن قوتك بما يناسب حياتك", bio: "أساعد المبتدئين على بناء قوتهم من خلال جلسات عملية وتقدم منتظم.", trainingServices: "تدريب القوة; تمارين الحركة; تدريب الأوزان", name: "القوة اليومية", description: "تدريب قوة شخصي مع متابعة أسبوعية" };
export const secondWebsiteOffer = { name: "Mobility programme", description: "Personal mobility practice with weekly check-ins", offerIncludes: "training", billing: "upfront", programmeDays: 30, priceAed: 249 };
export function websiteFixture(context) {
  if (context.websiteContent) {
    const ar = context.language === "ar";
    return { templateId: "minimal", pages: [
      { title: ar ? "الرئيسية" : "Home", slug: "", sections: [{ moduleId: "hero", variant: "split" }, { moduleId: "services", variant: "grid" }] },
      { title: ar ? "عن المدرب" : "About", slug: "about", sections: [{ moduleId: "about", variant: "portrait" }] },
      { title: ar ? "التدريب" : "Coaching", slug: "coaching", sections: [{ moduleId: "programmes", variant: "cards" }, { moduleId: "faq", variant: "accordion" }, { moduleId: "contact", variant: "centered" }] },
    ] };
  }
  const text = context.conversation.at(-1).text;
  const patch = text.includes(secondWebsiteOffer.name) ? secondWebsiteOffer : /أليكس/.test(text) ? arabicWebsiteFacts : websiteFacts;
  return { reply: /أليكس/.test(text) ? "تم حفظ تفاصيل تدريبك. اختر صورك للموقع." : "Your coaching details are recorded. Choose the photos for your website.", patch, evidence: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, String(value)])) };
}
