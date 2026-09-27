/**
 * Open Food Facts v2 product API double. Returns products for the barcodes
 * below and the documented {status:0} / 404 for unknown codes. Test-only.
 */
import { MockServer } from "./http.ts";

export const MOCK_PRODUCTS: Record<string, any> = {
  // Valid EAN-13 check digits.
  "6291003000014": {
    code: "6291003000014",
    product_name: "Mock Greek Yogurt Plain",
    brands: "Sandbox Dairy",
    serving_size: "170 g",
    ingredients_text: "Pasteurised milk, live cultures",
    allergens_tags: ["en:milk"],
    nutriments: {
      "energy-kcal_100g": 97,
      proteins_100g: 9,
      carbohydrates_100g: 3.6,
      fat_100g: 5,
    },
    rev: 12,
  },
  "5000159484695": {
    code: "5000159484695",
    product_name: "Mock Rolled Oats",
    brands: "Sandbox Mills",
    serving_size: "40 g",
    ingredients_text: "Whole grain oats",
    allergens_tags: ["en:gluten"],
    nutriments: {
      "energy-kcal_100g": 374,
      proteins_100g: 11,
      carbohydrates_100g: 60,
      fat_100g: 8,
    },
    rev: 3,
  },
};

export class FoodMock {
  readonly server: MockServer;
  constructor(tlsMaterial: { key: string; cert: string }) {
    this.server = new MockServer("openfoodfacts", tlsMaterial);
    this.server.route("GET", "/api/v2/product/:file", (r) => {
      const code = r.params.file.replace(/\.json$/, "");
      const product = MOCK_PRODUCTS[code];
      if (!product)
        return {
          status: 404,
          body: { code, status: 0, status_verbose: "product not found" },
        };
      return { body: { code, status: 1, status_verbose: "product found", product } };
    });
  }
  get url() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
}
