import { defineMessages } from "../core";

/** Plan price, length and voice terms (membership screens, coach website). */
export default defineMessages(
  {
    priceFor: {
      one: "{price} for # day",
      other: "{price} for # days",
    },
    perMonth: "{price} / month",
    onePayment: {
      one: "One payment for a #-day programme",
      other: "One payment for a #-day programme",
    },
    renewsBlocks: {
      one: "Renews monthly · #-day programme blocks",
      other: "Renews monthly · #-day programme blocks",
    },
    renewsRolling: "Renews monthly · rolling programme blocks",
    voiceIncluded: "Premium guided voice included",
    voiceAddOn: "Add premium guided voice for {price} / month",
  },
  {
    priceFor: {
      zero: "{price}",
      one: "{price} مقابل يوم واحد",
      two: "{price} مقابل يومين",
      few: "{price} مقابل # أيام",
      many: "{price} مقابل # يومًا",
      other: "{price} مقابل # يوم",
    },
    perMonth: "{price} شهريًا",
    onePayment: {
      zero: "دفعة واحدة للبرنامج",
      one: "دفعة واحدة لبرنامج مدته يوم واحد",
      two: "دفعة واحدة لبرنامج مدته يومان",
      few: "دفعة واحدة لبرنامج مدته # أيام",
      many: "دفعة واحدة لبرنامج مدته # يومًا",
      other: "دفعة واحدة لبرنامج مدته # يوم",
    },
    renewsBlocks: {
      zero: "يتجدد شهريًا · مراحل برنامج متتالية",
      one: "يتجدد شهريًا · مراحل برنامج مدة كل منها يوم واحد",
      two: "يتجدد شهريًا · مراحل برنامج مدة كل منها يومان",
      few: "يتجدد شهريًا · مراحل برنامج مدة كل منها # أيام",
      many: "يتجدد شهريًا · مراحل برنامج مدة كل منها # يومًا",
      other: "يتجدد شهريًا · مراحل برنامج مدة كل منها # يوم",
    },
    renewsRolling: "يتجدد شهريًا · مراحل برنامج متتالية",
    voiceIncluded: "التوجيه الصوتي المميّز مشمول",
    voiceAddOn: "إضافة التوجيه الصوتي المميّز مقابل {price} شهريًا",
  },
);
