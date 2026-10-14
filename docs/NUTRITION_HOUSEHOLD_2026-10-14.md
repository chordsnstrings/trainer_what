# Personal nutrition and weekly kitchen handoff

Status: implemented and merged in [PR #66](https://github.com/chordsnstrings/trainer_what/pull/66) as `4fb73f859ffe6b2fe2ca52df7aa408cf2869c6a9`. All exact-main checks passed and the feature is verified live.

## Audit

The existing module already stores versioned food facts, approved cooking variants, seven-day validated plans, daily nutrients, swaps, pantry/leftover quantities, purchase conversions, and explicit individual coach targets. Automatic plans require the trainer's nutrition teaching, independent checks and reviewed-week activation. Trainer subscriber preview uses those actual services.

Gaps: goal defaults were fixed calorie values without a personal maintenance calculation; food preferences had no structured cuisine/household information; the day selector could not print a complete week; groceries had no household cooking scale; the CSV endpoint did not recheck nutrition permission or current plan status. No retailer ordering integration exists.

## Ordered plan and acceptance

1. Add an optional coach-confirmed personal energy method by supported goal. Require explicit weight, height, equation sex and activity; show maintenance and signed deficit/surplus. Keep the existing fixed and individual coach targets and their provenance.
2. Persist cuisine/food preferences, explicit halal requirements, batch preference and household cook/portion/language/region choices. Use reviewed catalog facts; preferences never bypass allergy or scope checks.
3. Project the current delivered week into a cooking pack: seven dated days, reusable recipe cards, member versus cooking amounts, restrictions, storage instructions and whole-week groceries with verified purchase/pack conversions. Keep personal health/body/goal data out of this handoff.
4. Expose the same authenticated experience in trainer preview. Test arithmetic, scope, privacy, profile changes, isolation and print layouts; run ordinary release gates, merge and verify the exact serving SHA.

## Evidence and design decisions

Sources checked 14 October 2026:

- [Mifflin et al., 1990](https://pubmed.ncbi.nlm.nih.gov/2305711/): resting-energy prediction using weight, height, age and sex coefficients. The optional method uses the published equation. Activity factors 1.2/1.375/1.55/1.725 are explicit product planning assumptions, not measured energy expenditure or coefficients validated by that study.
- [NHS calorie guidance](https://www.nhs.uk/better-health/lose-weight/calorie-counting/): energy deficit supports weight loss; a population example is not a universal personal prescription.
- [NHS healthy weight gain](https://www.nhs.uk/live-well/healthy-weight/managing-your-weight/healthy-ways-to-gain-weight/): gradual gain, balanced foods and an example of 300–500 extra kcal daily. Unexplained weight changes require clinical review.
- [NIDDK programme selection](https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program): sustainable eating patterns should fit health, cultural needs and preferences. No one diet is selected solely from a weight goal.
- [NIDDK planner scope](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner): adult use; pregnancy/breastfeeding excluded. This implementation is not the NIH dynamic body-weight model and makes no kg/week or target-date promise.
- [Dubai Municipality consumer guidance](https://www.dm.gov.ae/municipality-business/for-consumers-in-dubai/): local shopping, food storage and allergen-handling resources. The kitchen handoff links this source, keeps ingredient preparation states explicit, and does not infer religion, nationality or household staffing from residence.

Conservative product limits for the optional equation: age 19–78, BMI at least 18.5, known general-wellness scope; trainer-chosen adjustment within ±500 kcal and deficit no greater than 25% of estimated maintenance; target above 1,200 kcal and within the trainer's approved bounds. These are screening rules, not a clinical safety guarantee. Existing clinical, pregnancy, eating-disorder and fasting screens remain higher priority. Missing or out-of-range data requires review, never silent clamping or guessed sex/activity.

Kitchen scaling means a chosen number of the subscriber's meal portions, not nutritional prescriptions for other household members. Shopping counts every planned meal once, including repeats; grouping recipe instructions does not remove food from the shopping total. Recipe cooking times and temperatures are never multiplied. Cooked-to-raw conversions and pack sizes require reviewed purchase facts. A saved cooking pack is a dated copy; a replacement week requires a new printout. No order or payment is placed.

## Verification

All eight final-head PR gates passed on `d3ec5cdb040f2da45a915f30ee73f0856e5ea3c4`: [application checks](https://github.com/chordsnstrings/trainer_what/actions/runs/38500241122) and [conversation](https://github.com/chordsnstrings/trainer_what/actions/runs/38500240859). Application: 1,883 passed, 0 failed, 5 skipped. PostgreSQL: 1,882 passed, 0 failed, 6 skipped. Conversation: 151 tests passed plus browser journeys. Production build, container, tenant boundaries and UI gates passed.

All seven [exact-main gates](https://github.com/chordsnstrings/trainer_what/actions/runs/38503248274) also passed, with the same application and PostgreSQL counts. No failed gate was waived. [Serving verification](https://github.com/chordsnstrings/trainer_what/actions/runs/38506258358) confirmed the exact merged release at **03:31:39 UTC on 14 October 2026**. Independent requests at **03:32:51 UTC** confirmed readiness HTTP 200, `status: ready`, homepage HTTP 200 and the exact release header on both responses. [Machine-readable receipt](NUTRITION_HOUSEHOLD_RELEASE_2026-10-14.json). Implementation, merge, deployment and serving verification are complete. This documentation-only follow-up changes no application behavior and follows ordinary automatic CI separately.

Local verification passed TypeScript, 59 focused nutrition tests, 14 translation tests, the production build and a 74-route browser journey with no browser errors. Targeted cooking-pack checks verified all seven days, three grouped recipe cards, a three-portion household's full-week amounts, a fresh CSV download, phone/desktop widths and English/Arabic A4 print output. Both five-page PDFs were rendered and visually inspected. Initial verification exposed a Next.js type-narrowing issue, an English label in Arabic, and print sizing/pagination issues; these were fixed before the final gates. No live paid provider evaluation or grocery purchase has been made.

Migration `097_nutrition_cuisines` adds immutable recipe cuisine metadata with existing RLS and member-helper boundaries. Profile and plan metadata use existing versioned records. Prompt pin is `nutrition-cases-v6`; nutrition releases must pass fresh evaluation and reviewed-week activation before automatic generation resumes. Existing checked weeks remain available unless their profile/catalog/safety state changes.

Browser coverage includes seven printed days, per-person and whole-household quantities, English/Arabic headings, phone/desktop overflow checks and A4 PDFs. Recipe text remains in the language entered by the trainer; changing print language translates headings only.

## Using the feature

- Subscriber: open Nutrition → Food preferences. Add optional estimate inputs and set Cooking and household preferences, including who cooks, number of your portions, print language and shopping location. Save the profile and prepare a current week.
- Trainer: use Nutrition → Policy to choose the personal energy intent and calorie adjustment for each supported goal, then complete the existing policy review, evaluation and reviewed-week activation. Add cuisine metadata and verified purchase facts to reviewed recipes/ingredients.
- Open Weekly cooking pack from Meals or Groceries. Preview in English or Arabic, print/save PDF, or download the household shopping CSV. Recipe instructions retain the trainer's original language.
- Trainer subscriber preview uses its own private subscriber profile and the same Nutrition screens and services, including cooking preferences and the weekly pack.
