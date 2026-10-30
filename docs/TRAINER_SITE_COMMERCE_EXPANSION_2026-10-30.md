# Six trainer websites: pricing, joining and new directions — 30 October 2026

The owner accepted the direction of the first three motion studies and requested pricing, signup and more versions. The collection now has six complete sample websites. Native owner-private publication succeeded as version 3; the exact checked source was pushed and packaged before publication. Use the private preview shared in the conversation. Private Site and source identifiers are intentionally omitted here.

## What changed

| Website | Organizing idea | What to try |
| --- | --- | --- |
| Mara Vale | The coach documentary | Scroll the continuous film into the coach introduction, then compare membership rows and join. |
| Common Ground | The client journal | Read three coordinated fictional chapters, then choose a membership from the editorial cards. |
| Dayform | A week with your coach | Unfold the week, switch days and busy-week mode, then compare the three levels of support. |
| Starting Line — new | Find your starting point | Choose a preference. The image, explanation, steps and suggested plan change together. Any plan remains available. |
| FORM / SESSION — new | Inside a session | Use the three phase buttons or scroll through the continuous film and coaching cues. Review the technical pricing comparison. |
| Sunday Club — new | Find your people | Scroll the mosaic into an invitation. Filter the example week, open a session, then explore online membership tickets. |

The new structures differ in the visitor's first decision, information order, signature motion and route into membership. The shared component is the commercial contract. All six remain fictional; illustrative photography is not an endorsement, the journal is not a real testimonial, and the club calendar is not live availability.

## Pricing and inclusions

The prototype uses the minimums in [the versioned membership contract](../packages/contracts/src/membership-pricing.ts), policy `membership-2026-10-14`. These are sample offers, not a statement that every trainer charges the minimum.

| Membership | Monthly | 6 months upfront, 10% saving | 12 months upfront, 30% saving |
| --- | ---: | ---: | ---: |
| Training | AED 199 | AED 1,074.60 | AED 1,671.60 |
| Training + nutrition | AED 299 | AED 1,614.60 | AED 2,511.60 |
| Complete, including AI voice | AED 399 | AED 2,154.60 | AED 3,351.60 |

Prices are calculated in integer fils. The interface shows the full prepaid amount alongside its monthly equivalent, explicitly stating that the equivalent is not an instalment. The same plan and term carry into signup and review. Going back to edit either recalculates the total.

Included support is described in plain language. Nutrition is not included in Training; AI voice is only in Complete. Live sessions, events and venue access are separate from online membership. The FAQ distinguishes trainer-taught AI from live personal coaching. Prepaid refund copy follows the platform's 15-day request window and full monthly-rate deduction for started months; this preview neither collects nor refunds money.

## Signup and returning-member journeys

1. **Membership:** review or change the selected plan, billing term, inclusions and exact sample amount.
2. **Details:** use the prefilled example name/email or change them; choose a starting point and experience. Invalid or missing values produce focused errors.
3. **Review:** inspect plan, payment option, amount and details; go back to edit; acknowledge the preview and complete it.
4. **Confirmation:** see an honest preview receipt and the intended next steps. No account or payment success is implied.

The member sign-in entry provides a returning-member demonstration, using an example email and clearly labelled sample home. It does not authenticate an account. Privacy details are accessible from the footer and signup review.

No form data is transmitted or persisted. Close/reload clears the edited details; only the motion setting uses local storage. Forms use `method="dialog"` so native fallback cannot send the data if JavaScript is unavailable. Production legal consent, real account creation, login, checkout, tax calculation and booking remain outside this independent preview.

## Motion, phone behavior and modularity

Native scrolling and local GSAP/ScrollTrigger coordinate the six narratives. No Three.js/WebGL is used on the current routes. Long desktop compositions have shorter or sequential phone alternatives; reduced motion and local pause preserve the complete content and controls.

The [version 3 contracts](trainer-motion-studies/contracts.json) add goal-led routing, session phases, a club mosaic/schedule and the membership/join state contract. The latter separates plan, billing term, step, transient details and preview acknowledgement. These are prototype composition records for future Seed selection; no production planner/editor is connected.

Three new pricing arrangements supplement the original three: a preference-linked list, a technical comparison and club-style tickets. All preserve the same commercial facts. Changing visual style must not change entitlements, amounts or checkout meaning.

## Evidence and limits

| Check | Result |
| --- | --- |
| Generated structure, data and local references | 398 assertions passed. |
| Commerce and new interaction state | 953 assertions; all 54 site/plan/billing combinations plus validation, back/edit, reset, safe text, preferences, filters, reduced motion and denied storage. |
| Retained original interactions | 184 assertions passed. |
| Actual GSAP calculations | 327 assertions with plain-property targets and synthetic dimensions; includes forward/reverse/settled session and club states. |
| CSS | 1,134 selectors / 3,078 declarations parsed. |
| Sampled solid-colour contrast | 25 pairs, minimum 4.77:1. Not whole-page accessibility or photograph-overlay qualification. |
| Phone type estimates | 75 original-font advance estimates at five widths; three long lines corrected. Not browser shaping/wrapping. |
| Other | JS syntax, diff whitespace and eight archive check groups passed; reused photographs inspected. |

[Machine-readable receipt](trainer-motion-studies/verification.json). Source test scripts and raw receipts are retained in the private Site repository.

No connected local Browser tool was exposed; the standing instruction prohibits cloud-browser use. Actual scroll/sticky geometry, six-page phone/desktop rendering, native dialog focus, touch flick/stop/reverse behavior, video decode/GPU cost and device frame pacing remain unverified. Native publication establishes delivery, not smoothness or owner visual acceptance.

## Next step

Review the new narratives and the complete pricing-to-signup journey on desktop and phone. Refine the accepted directions before expanding toward ten. Before production integration, use actual tenant-qualified offers, published legal terms, authenticated identities and server-confirmed checkout amounts, preserving existing isolation, payment reconciliation, revision and publication boundaries. Review animation-engine licensing for the intended builder architecture.

The original ten prototypes remain rejected and archived. This phase does not merge application changes, modify tenant data, call paid providers or deploy trainsyou. The handoff and completion records remain on the existing documentation review branch and draft PR #107.
