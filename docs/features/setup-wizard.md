# Coach setup wizard and Keep training (web)

Round 4, branch `r4/wizard-web` (from `r4/integrate`). Owner decisions of 30 September 2026:
one wizard of about 15 minutes, open self-serve sign-up behind the existing legal/registration
switch, a custom subdomain for every coach, and "Keep training" after launch. The API is in
`coach-setup.md`, `brain-teach.md` and `setup-assistant.md`; this page covers the screens.

## Getting in

- The marketing header button is **Start coaching** (`claimCta`, `components/marketing/frame.tsx`)
  and leads to `/signup`. While registration is closed it stays "Join early access".
- `/signup` (`TrainerSignUp`, `components/public-pages.tsx`) reads
  `GET /public/signup-options`:
  - registration off: the early-access form is the way in (no sign-up form);
  - email codes on (a Resend key saved in Super admin): email, then the 6-digit code with name,
    optional password and the legal acceptance (`/auth/signup/code`, `/auth/signup/verify`);
  - otherwise, or with "Use a password instead": name, email, password (`/auth/register`, no
    address field; a `?slug=` hint from the address preview is still passed when present).
  - `EMAIL_CODES_OFF` switches to the password form; `LEGAL_PENDING` says sign-up opens soon.
- After sign-up the workspace opens `/setup`.

## The wizard: `/setup` (alias `/trainer/setup`)

`components/setup-wizard.tsx` (shell and steps 1, 2, 3, 5, 6), `setup-brain.tsx` (step 4 and Keep
training), `setup-assistant-panel.tsx` (chat), `setup-wizard-model.ts` (pure decisions, tested),
`app/setup-wizard.css`.

- `/setup` opens the step to resume (`resumeStep`); `/setup/<step>` opens a step
  (`account, about, page, brain, plan, live`); `/setup/keep-training` opens Keep training. Once the
  page is live, `/setup` opens Keep training.
- Top: "Step n of 6", the progress bar (`progress.percent`), "n of 6 done · About N minutes left",
  "Save and continue later" (answers save as the coach goes) and the six steps with their status
  (Done, Started, To do, Skipped for later, Waiting on trainsyou). On a phone the steps become six
  numbered dots and Back / Skip for later / Continue stick to the bottom.
- Every step has Back and Continue; about, page, brain and plan have **Skip for later**
  (`PUT /setup/:step {skip:true}`; go-live still checks the step).
- **Chat with the assistant** (about, page, brain, plan): a panel beside the form on a laptop, a
  full-screen sheet on a phone (under 860 px). It shows the step's chat, the next question, "Skip
  this question" and the draft so far. It only drafts:
  - about, page, plan: "Put this in the form" copies the draft into the short form
    (`aboutFromDraft`, `pageFromDraft`, `planFromDraft`; a price only when the coach wrote one; a
    city is matched to its emirate, e.g. "Dubai Marina" → Dubai, "Al Ain" → Abu Dhabi); the coach
    then saves;
  - brain: "Draft my rules from this chat" (`apply compile`) and "Save my limits" (`apply limits`);
    the new rules appear as cards to approve.
- Older checklist addresses redirect: `/trainer/onboarding`, `/account`, `/identity`, `/brand`,
  `/preview`, `/offer`, `/publish` open the matching wizard step (`legacySetupRedirect`); the other
  `/trainer/onboarding/*` screens (share, payout, interview, uploads, nutrition...) still open.
  The "Setup" menu item points to `/setup`.

### Steps

1. **Create account**: done when the email is confirmed.
2. **About you**: name, specialty (offered ones only; hidden specialties stay hidden), who you
   coach, emirate, Instagram, and optionally the programme: a website link ("Read my website",
   `POST /setup-assistant/website`) or a file (`POST /brain/documents`), both behind a "my own
   material" tick and kept private until reviewed in My Brain. Prefilled from `about.values`
   (early-access answers included). Saves as the coach types (`PUT /setup/about`, optimistic
   version; `STALE_ONBOARDING` asks for a reload).
3. **Your page**: headline and about-you text (`PUT /tenant/brand`), the web address picker
   (live check `GET /setup/subdomain/check` 400 ms after typing, free suggestions as chips,
   "Reserve this address" / "Keep this address" `PUT /setup/subdomain`; after launch renames go to
   Web address), and "Approve my page" (`PUT /setup/page` with `approvalVersion` and `digest`),
   blocked while the text is unsaved or the page has contact details, links or health claims.
4. **Teach your Brain**: a three-item checklist, then
   - rule cards: "Approve all N" for warning-free drafts (`POST /brain/rules/approve-all` with the
     `approveAll` list shown), flagged rules one by one with their warning in plain words and an
     "I read the warning" tick (`POST /brain/rules/:id/confirm {acknowledgeFlags:true}`) or "Edit in
     My Brain"; "Tell your Brain a rule in your own words" (`POST /brain/teach/chat`);
   - the practice quiz (`POST /brain/quiz/rounds`, one question at a time, "Would you reply like
     this?" Yes / Change with the coach's reply; platform safety questions are marked);
   - "Your own client questions": 3 needed (`POST /brain/scenarios`, held out, rule and "should this
     come to you" chosen by the coach);
   - "Finish teaching my Brain" (`POST /brain/releases/supervised`), enabled when `launch.supervised`
     is ready; the Brain then drafts in "Waits for me".
5. **Your plan**: suggested name ("Strength coaching with Alex"), what clients get, monthly or once
   for a fixed programme (days), price typed by the coach (at least AED 2), `POST /products`. Bank
   details are asked at the first payout.
6. **Go live**: the coach checks with a Fix link to their step, one "Waiting on trainsyou" line for
   trainsyou's checks, and Go live (`POST /setup/go-live`). `MFA_STEP_UP` opens the authenticator
   right there: verify (password + code), or set one up (password → key / `otpauth:` link → code →
   recovery codes) and go live. A coach without a password is sent to set one first.
   After going live: the address, and "Keep training your Brain".

## Keep training: `/setup/keep-training`

"Brain trained" meter (`GET /brain/teach` `meter`, 0-100) with the level name, what to do next and
the four levels ("Every reply waits for you" → up to 30 routine replies send automatically; health
and safety questions always come to the coach). Train more: rule cards, "Teach a new rule",
another quiz round, and "Suggest rules from my corrections" (`POST /brain/teach/suggestions/compile`)
when quiz changes or corrected replies are waiting. Grow: the `grow` list from `GET /setup` (voice
clone, nutrition, own domain, bank details at first payout, optional qualification badge).

## Safety floor (unchanged)

The assistant and the Brain only draft; nothing here sends to a member. Flagged rules are never in
"Approve all". No model or vendor name appears in any wizard text (tested). The screens use plain
words ("Waits for me", "Practice quiz", "My page"), no jargon.

## Tests and checks

`tests/setup-wizard-web.test.ts` (addresses, redirects, subdomain line, rule groups, quiz position,
checklist, draft mapping, plan and go-live helpers, the sign-up screen, workspace routing, no vendor
names or jargon). `tests/brand.test.ts` and `tests/public-pages.test.ts` follow the "Start
coaching" label. `scripts/browser-check.mjs` now fills About you in the wizard, checks it resumes
after a reload, opens Your page and checks the phone width at `/setup/about` (not run in this
round).

## Live model check (Seed 2.0 Pro, 30 September 2026)

No prompt changed on this branch. The wizard's "Put this in the form" contract was checked live:
six simulated coaches (strength, weight loss, muscle gain, pre/postnatal, a rambling one and an
adversarial one) through the app's setup assistant (`setup-assistant-v3`, prompt builder, model
call and checks) for About you, Your page and Your plan, then the final drafts through the wizard's
own mapping and the validators the forms call (`setupAboutSchema`, `pageIssues`, `productSchema`).
Results are in `CLAUDE_HANDOFF.md` / `docs/COMPLETION_STAGES.md` (stage 2026-09-30r4-wiz); script
in the session scratchpad `round4-evals/wizard-web/` (not in the repository).

## Not done here

- Voice notes in the chat panel (the endpoint exists; no recorder in the panel yet).
- A list of the coach's own client questions (count only; no list endpoint).
- Arabic strings (the trainer area is English-only; deferred by the owner).
- Google and Apple sign-up (later, per the owner).
