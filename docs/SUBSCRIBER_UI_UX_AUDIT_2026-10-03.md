# Subscriber UX/UI audit — 3 October 2026

Owner requested a comprehensive audit and confirmed fixes. Base: live main `97fd03c`. Branch: `work/subscriber-ux-2026-10-03`. Audit complete. Fixes passed all four PR CI jobs on `ddaba406`; PR #28 merged as `e5757e4f02f25fd291ba23cbbcc12d8d820a83af` after the owner approved deployment and saving the update. All four main CI jobs passed; the exact release and new web assets are verified live at https://trainsyou.com.

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

No production records or paid provider calls. Real-device keyboard/PWA installation, microphone/speech, HealthKit, payment-provider settlement and delivered email/push require their respective device/provider evidence. Existing safety, consent, tenant and financial rules remain in place. Production deployment is verified below; live checks used signed-out GET requests only. Authenticated workflows were tested in isolated CI.

## Release and saved handoff

Owner approved on 3 October 2026 at 21:43 Asia/Dubai: “Deploy. And save the update”. This explicitly authorizes saving the updated Claude handoff/project notes, including the existing infrastructure metadata that automatic approval previously blocked, to `chordsnstrings/trainer_what`.

- [PR #28](https://github.com/chordsnstrings/trainer_what/pull/28) merged as `e5757e4f02f25fd291ba23cbbcc12d8d820a83af`.
- [PR qualification 37133162669](https://github.com/chordsnstrings/trainer_what/actions/runs/37133162669): all four jobs passed on `ddaba4061ba2801ff8f1c3999cd5a69064a7d984` at 15:55:02 UTC. The merge has the identical application tree.
- [Main qualification 37141834383](https://github.com/chordsnstrings/trainer_what/actions/runs/37141834383): all four jobs passed at 18:13:54 UTC. Application suite: 1,648 pass, five skips, zero failures; build, subscriber journeys, general browser regression, 16 builder journeys, 1,620 layout checks, backend UI checks, restricted PostgreSQL/container and Compose topology passed. Existing newest-green-main automation deployed the release.
- Final handoff and live-release evidence are saved on `notes/subscriber-ui-release-2026-10-03`, descending from the merge, and linked from PR #28. The previous backend release checkpoint is reconciled into these notes.

### Production verification — 3 October 2026

- 18:20:51 UTC: `/api/v1/ready` returned actual HTTP 200, `{"status":"ready"}` and `X-GymMembership-Release: e5757e4f02f25fd291ba23cbbcc12d8d820a83af`.
- 18:21:39 UTC: readiness rechecked, four subscriber route shells (`/app/chat`, `/app/intake`, `/app/bookings`, `/app/profile`) and all 23 linked JS/CSS assets returned HTTP 200. The served `/_next/static/chunks/1japcc3gw6j_4.js` contains the new `workspace-value-changed` marker.
- One readiness probe returned HTTP 502 with the new release header at 18:20:05 UTC during rollout; the next probe was healthy.
- Exact route/asset hashes and readiness evidence: [production proof](evidence/subscriber-ui-2026-10-03.json).
- No production records, paid calls, cloud browser, SSH or manual deployment. Release complete; reconcile the saved documentation checkpoint into the next application release.
