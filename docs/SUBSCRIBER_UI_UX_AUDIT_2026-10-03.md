# Subscriber UX/UI audit — 3 October 2026

Owner requested a comprehensive audit and confirmed fixes. Base: live main `97fd03c`. Branch: `work/subscriber-ux-2026-10-03`. Audit complete. Fixes are implemented and locally verified; review CI is the next release gate.

## Coverage

| Area | Surfaces and flows |
| --- | --- |
| Entry | Coach directory/site, joining/invitation, sign-in/recovery, legal/consent |
| Daily use | Today, programme/calendar, workout/guided/voice sessions, progress |
| Coaching | Chat/replies/attachments, intake, coaching context |
| Nutrition | Meal plan, diary/capture, profile/consent, groceries |
| Services | Bookings, galleries, connections, notifications, support |
| Account | Membership/renewal/payment states, profile/security/privacy, coach switch/sign-out |
| Shared UI | Phone/tablet/desktop layout, buttons/fields, keyboard/sheets, loading/error/empty states, contrast, dark mode, Arabic/RTL, reduced motion |

Existing member design remains phone-first: 16 px gutters, 44 px targets (48 px primary), five bottom tabs, branded tokens, safe-area/keyboard insets. Backend white-only appearance does not override the member's own appearance choice.

## Confirmed findings and changes

| Priority | Finding | Change |
| --- | --- | --- |
| High | Chat treated a successful send followed by a failed refresh as a failed send, inviting duplicates. | Separate send/refresh outcomes; retain the draft until acceptance; clear accepted text and attachments only. In-flight sends stay guarded when leaving and returning to Chat, and completion updates the current screen. |
| High | Booking actions could similarly replace a successful reservation/cancellation with a refresh error. | Keep the accepted result and payment link; show a separate retry; block further changes against stale data. |
| Medium | Chat and booking reads had no deadline or explicit recovery; chat read errors persisted after recovery. | Bounded reads, localized retry controls, preserved content and cleared recovered errors. |
| Medium | Chat text/attachments and unfinished coaching-profile answers disappeared on navigation/reload. | Session-only drafts scoped by coach/member/role; intake resumes its step. Changed saved answers supersede old drafts. Consent must be checked again. Sign-out clears drafts; late callbacks cannot recreate them. |
| Medium | Empty/out-of-range training-day values could advance beyond the intake step and fail only on Save. | Validate 1–7 whole days at the relevant step with localized feedback; browser checks cover blank and 99. |
| Medium | Password/provider settings were separated from sign-in security, lengthening Profile. | Group password, provider, authenticator and session controls together. Open the group on account callbacks; the profile section cannot consume the security result. |
| Low | The default Programme phone tab clipped at 390 px (79 px text in 74 px available). | Compact localized Plan label; retain full page/desktop labels and coach-customized names. |

## Design assessment

The existing member shell already provides consistent 16 px phone gutters, shared primary/secondary buttons, reachable bottom actions, accessible fields, sheets and useful empty states. Settled screenshots of all 17 standard member routes were reviewed, plus desktop Today and the running voice fallback. Preserve these shared primitives and coach/member appearance preferences; a wholesale restyle is unnecessary for the confirmed defects.

Coverage includes signed-out entry/joining/recovery/legal pages; all 17 member routes; active workout, guided workout and voice session routes; notifications, support and membership states; bottom navigation, settings, loading/error states and draft continuity. Route/geometry checks do not prove real provider completion.

## Verification

- Root TypeScript and production build pass.
- 89 relevant unit/contract tests pass, including member screens/navigation/motion, account UI, Arabic catalogs, untranslated copy, logical CSS and personal cache handling.
- First phone baseline: 68 measurements, no page JavaScript errors; two native headless speech crashes. Browser stderr identifies a missing `media.mojom.OnDeviceSpeechRecognition` binder, not an application exception.
- With the unsupported headless capability disabled (`OnDeviceWebSpeechAvailable,OnDeviceWebSpeechQuality`), the voice fallback starts and keeps Done/Report pain reachable. No application speech behavior was changed.
- All eleven subscriber journey checks pass: initial-read retries, retained chat/intake drafts, rejected send recovery, accepted send/reservation with failed refresh, explicit intake consent, sign-out cleanup, unclipped 360 px tab labels and visible account callback results. English and Arabic phone checks each pass 71 measurements with no failures/page errors. Dark mode passes 61 screens and 2,016 text elements scanned, with no failures/page errors.
- New CI job runs `scripts/subscriber-ui-check.mjs` through `scripts/run-subscriber-ui-check.mjs` against an isolated loopback fixture with a fresh generated password. Screenshots and JSON results are retained as CI artifacts.

The dark-mode runner’s obsolete unavailable-screen text selector was corrected to the current accessible heading and the full check rerun successfully. Fixture runners generate fresh passwords.

No production records or paid provider calls. Real-device keyboard/PWA installation, microphone/speech, HealthKit, payment-provider settlement and delivered email/push require their respective device/provider evidence. Existing safety, consent, tenant and financial rules remain in place. This branch is not deployed.

## Documentation publication

The updated Claude handoff, project memory and previous release verification are prepared locally. Automatic approval rejected republishing the handoff’s existing live infrastructure/service metadata, even after confirming that it already exists in this repository. Those three documentation updates await explicit owner approval for this GitHub destination. The subscriber code and this audit can be reviewed independently.
