# Live Seed conversation replay

`scripts/onboarding-live-check.ts` exercises the real `onboardingReply` provider and the same prepare → grounded merge → finish logic used by subscriber profile conversations. It uses three fictional scenarios: the reported beginner/weekday/delegation conversation, a later correction and hypothetical question, and uncertainty → recommendation → explicit acceptance. Fourteen turns are planned. Every turn deliberately calls the model, including answers the running app can handle locally, to inspect the provider's actual structured output.

Run only in an environment that already has the approved Seed connection in `MODEL_BASE_URL`, `MODEL_API_KEY` and `MODEL_NAME`. The script requires Seed 2.0 and a public HTTPS endpoint, refuses fixture/local URLs, fetches no credentials, switches no profile and writes no application records. Existing request-style, timeout and token settings flow through the shared provider gateway. There is no fallback or automatic retry after a failed/unknown inference outcome.

```sh
node --import tsx scripts/onboarding-live-check.ts \
  --out /absolute/path/outside-the-repository/onboarding-live.json \
  --max-calls 14
```

`--max-calls` defaults to 14 and has a hard ceiling of 32 reservations. Calls are sequential. The existing gateway may retry a request parameter only when the provider explicitly refused it without reported usage; there is no second logical inference reservation.

Optional `--max-cost-usd 0.50` requires the configured input/output prices, `MODEL_PRICE_VERSION` and a finite `onboarding_reply` output-token cap before any paid call. Before each call it reserves a conservative byte-based input allowance plus the maximum output allowance, using the highest configured input/cache price. It stops if the next reservation would exceed the remaining ceiling or if reported cost is unknown. No price is invented. This is local evaluation accounting, not a debit to an application's tenant ledger.

The required external JSON report is checkpointed after usage and completed turns. It contains the fictional inputs, actual parsed model responses, code-reconciled responses, facts/preferences, named assertions, latency, provider-reported token usage and cost calculated by the existing configured pricing. It records unknown usage as null. It contains no key or configuration dump. Exit codes: 0 for completed machine checks, 1 for a failed/unfinished replay, 2 for an initial access/configuration blocker. A blocked report with zero calls is not live-model evidence. Machine checks establish specific behavior; the actual wording still needs human review, and this script does not test authenticated UI, plan generation or production release acceptance.

Local attempt on 12 October 2026 was blocked: `MODEL_BASE_URL`, `MODEL_API_KEY` and `MODEL_NAME` were absent. It made zero calls, used zero tokens and incurred no model cost. Actual Seed responses and human conversation quality therefore remain unverified from this session.
