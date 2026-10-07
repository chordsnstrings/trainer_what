# trainsyou — UAE policy pack

Prepared 7 October 2026. English only, as requested by the owner. Owner-approved policies for immediate publication and subsequent UAE lawyer review; no legal opinion or compliance certification is claimed.

## Documents

| Website page | Document | Coverage |
| --- | --- | --- |
| `/terms` | [terms.en.md](terms.en.md) | Account and trainer terms; subscriptions; cancellation, refunds and bookings; acceptable use; content, testimonials and voice rights; complaints; responsibility and UAE law |
| `/privacy` | [privacy.en.md](privacy.en.md) | Data purposes and roles; sensitive information and consent; AI and providers; international processing; retention, erasure and rights; cookies and marketing |
| `/ai-disclosure` | [ai-disclosure.en.md](ai-disclosure.en.md) | Automated and human coaching; exercise and nutrition limitations; guided sessions, music, voice and wearables; safety and review requests |

## Publication authorised

On 7 October the owner explicitly instructed: "just publish. don't bother about all this for now. We will update later." This supersedes the earlier request to wait for company/licence/address/contact details. Those details remain unset; none are invented or displayed as placeholders. The policies direct account holders to the existing Support and Privacy tools. Publication is authorised now; lawyer review and identity/contact updates follow separately.

Migration `090_publish_uae_policies.sql` publishes all three immutable versions and sets `LEGAL_APPROVED=true` in one transaction on an existing installation with a platform administrator. It retains older documents and other settings. An unprivileged release identity records the automated action, with no login password or memberships. The publication audit prevents repeated activation. Fresh databases without an administrator retain their normal setup flow.

Customer acceptance and optional data-use permissions remain explicit and separately recorded. The earlier signup-gate bypass is superseded and is not included. After deployment, verify the three public documents, `/public/legal-status` and `/public/signup-options`. Later lawyer edits must be new published versions, not changes to the applied migration. This release does not assert lawyer approval.

## Lawyer review

Confirm the operator's licensing and platform/trainer responsibilities; statutory consumer remedies and language requirements; applicability of federal, health-sector and any relevant free-zone rules; international-processing safeguards and provider agreements; the retention schedule; and whether a separate trainer data-processing agreement is needed. English-only delivery follows the owner's scope; it is not a finding that UAE Arabic-language obligations are inapplicable. Check the actual refund, incident-response, consent and deletion processes against the commitments before describing them as legally verified. Do not add blanket negligence waivers, deemed health-data consent or non-refundable labels that override mandatory remedies.

## Research and factual basis

Official-source research checked 7 October 2026. Search-index material was available; some direct legislative downloads returned access errors. Counsel should verify the current consolidated texts and applicable implementing measures.

- [UAE Government: data protection laws](https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws).
- [Federal Decree-Law 45 of 2021 — Personal Data Protection](https://uaelegislation.gov.ae/en/legislations/1972).
- [Federal Law 15 of 2020 — Consumer Protection](https://uaelegislation.gov.ae/en/legislations/1455).
- [Federal Decree-Law 14 of 2023 — Modern Technology-Based Trade](https://uaelegislation.gov.ae/en/legislations/2150).
- [Federal Law 2 of 2019 — ICT in Health Fields](https://uaelegislation.gov.ae/en/legislations/1209).

Product wording was checked against account, joining, consent, privacy-lifecycle, acquisition, payment and coaching code. No UAE-only processing, automatic universal erasure, guaranteed fitness results, live human monitoring, provider certification or lawyer approval is represented. No named hosting location is disclosed in the policy pack.
