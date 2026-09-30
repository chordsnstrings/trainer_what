"use client";
import { Onboarding } from "./onboarding";
import { NutritionCoach } from "./nutrition";
import { FollowerEstimate, ShareYourLink } from "./trainer-growth";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDate } from "../lib/format";
import { TrainerDesign } from "./trainer-design";
import { urgentFirst } from "./workspace-paging";
import { SETUP_HREF } from "./workspace-nav";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  MessageCircle,
  FileText,
  Brain,
} from "lucide-react";
import { money } from "@trainer/domain";
import {
  Empty,
  Badge,
  Card,
  Heading,
  type ViewProps,
  total,
  kindTotal,
} from "./workspace-ui";
import { BrainView } from "./workspace-brain";
import { Members } from "./workspace-clients";
import { Programs, workoutStatusText } from "./workspace-training";
import { Finance, PayoutView } from "./workspace-finance";
export function Overview({ state, records }: ViewProps) {
  const sub = state.user.role === "subscriber";
  // Members read their Today in their language; the trainer view is unchanged.
  const t = useT("today"),
    workoutT = useT("workout"),
    locale = useLocale();
  const rules = records("rule").filter((x) => x.status === "confirmed"),
    exceptions = urgentFirst(
      records("exception").filter((x) => x.status === "open"),
    ),
    programs = records("program"),
    workouts = records("workout");
  const confirmedRules = total(state, "confirmedRules", rules.length),
    programCount = kindTotal(state, "program", programs.length);
  const steps = [
    ["Shape your identity", !!state.tenant.theme?.bio, "/trainer/brand"],
    [
      "Teach your coaching rules",
      confirmedRules > 0,
      "/trainer/brain/constitution",
    ],
    [
      "Add your source material",
      kindTotal(state, "source", records("source").length) > 0,
      "/trainer/brain/knowledge",
    ],
    ["Create your first program", programCount > 0, "/trainer/programs"],
    [
      "Prepare your offer",
      kindTotal(state, "product", records("product").length) > 0,
      "/trainer/products",
    ],
  ] as const;
  return (
    <>
      <Heading
        eyebrow={
          sub
            ? formatDate(new Date(), {
                weekday: "long",
                year: false,
                longMonth: true,
                locale,
              })
            : new Intl.DateTimeFormat("en-AE", {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(new Date())
        }
        title={
          sub
            ? t("greeting", { name: state.user.name.split(" ")[0] })
            : `Good to see you, ${state.user.name.split(" ")[0]}.`
        }
        detail={
          sub
            ? t("subtitle")
            : "A clear view of your people, your coaching and your business."
        }
        action={
          <Link
            className="button secondary"
            href={sub ? "/app/program" : "/trainer/brand"}
          >
            {sub ? t("viewProgram") : "Edit my page"}
            <ArrowUpRight size={16} />
          </Link>
        }
      />

      {state.user.role === "owner" && (
        <section className="card" aria-labelledby="growth-nudge-h">
          <h2 id="growth-nudge-h">What could your followers be worth?</h2>
          <p>
            Estimate how many followers could become paying subscribers when
            you share your link, from published benchmarks and your own
            numbers. An estimate, never a promise.
          </p>
          <Link className="button secondary" href="/trainer/growth">
            Followers and growth <ArrowUpRight size={14} />
          </Link>
        </section>
      )}
      <div className="stats-grid">
        {(sub
          ? [
              [
                t("statCompleted"),
                total(
                  state,
                  "completedWorkouts",
                  workouts.filter((w) => w.status === "completed").length,
                ),
                t("statCompletedNote"),
              ],
              [
                t("statSets"),
                total(state, "sets", state.sets.length),
                t("statSetsNote"),
              ],
              [t("statPrograms"), programCount, t("statProgramsNote")],
              [
                t("statMessages"),
                kindTotal(state, "message", records("message").length),
                t("statMessagesNote"),
              ],
            ]
          : [
              [
                "Clients",
                total(
                  state,
                  "subscribers",
                  state.members?.filter((m) => m.role === "subscriber")
                    .length ?? 0,
                ),
                "People you coach",
              ],
              [
                state.finance ? "Trainer earnings" : "Programs",
                state.finance ? money(state.finance.earnedMinor) : programCount,
                state.finance
                  ? "Your balance"
                  : "Training blocks in this workspace",
              ],
              ["Confirmed rules", confirmedRules, "Your methodology, captured"],
              [
                "Needs you",
                total(state, "openExceptions", exceptions.length),
                "Things that need you",
              ],
            ]
        ).map(([label, value, note], i) => (
          <Card key={String(label)} className={"stat stat-" + i}>
            <span className="small-label">{label}</span>
            <strong>{value}</strong>
            <span className="muted">{note}</span>
          </Card>
        ))}
      </div>
      <div className="two-columns wide-left">
        <Card className="feature-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">
                {sub ? t("nextSession") : "THE COACHING ENGINE"}
              </p>
              <h2>
                {sub ? t("ready") : "Make your experience teachable."}
              </h2>
            </div>
            <span className="round-icon">
              <Brain size={28} />
            </span>
          </div>
          <p className="muted lead">
            {sub
              ? t("readyText")
              : "The best part of your coaching isn’t a template. It’s knowing what to change, when to change it, and why."}
          </p>
          <div className="brain-flow">
            <div>
              <span>01</span>
              <strong>{sub ? t("prepare") : "Teach"}</strong>
              <small>
                {sub ? t("prepareNote") : "Share your decisions"}
              </small>
            </div>
            <ArrowRight size={18} />
            <div>
              <span>02</span>
              <strong>{sub ? t("train") : "Refine"}</strong>
              <small>{sub ? t("trainNote") : "Review the rules"}</small>
            </div>
            <ArrowRight size={18} />
            <div>
              <span>03</span>
              <strong>{sub ? t("reflect") : "Go live"}</strong>
              <small>{sub ? t("reflectNote") : "Stay in control"}</small>
            </div>
          </div>
          <Link
            className="button"
            href={sub ? "/app/program" : "/trainer/brain"}
          >
            {sub ? t("openProgram") : "Continue building my Brain"}
            <ArrowRight size={16} />
          </Link>
        </Card>
        <Card>
          <div className="card-heading">
            <h2>{sub ? t("coachingSpace") : "Your launch checklist"}</h2>
            <Badge>
              {sub
                ? t("personal")
                : `${steps.filter((s) => s[1]).length} / ${steps.length}`}
            </Badge>
          </div>
          {sub ? (
            <>
              <p className="muted">{t("spaceText")}</p>
              <Link className="checklist-row" href="/app/intake">
                <span className="step-circle">
                  <FileText size={17} />
                </span>
                <span>{t("completeProfile")}</span>
                <ChevronRight size={16} />
              </Link>
              <Link className="checklist-row" href="/app/chat">
                <span className="step-circle">
                  <MessageCircle size={17} />
                </span>
                <span>{t("talkToTrainer")}</span>
                <ChevronRight size={16} />
              </Link>
            </>
          ) : (
            steps.map(([label, done, url], i) => (
              // Until the page is live, setup happens in the wizard (/setup).
              <Link
                className="checklist-row"
                href={state.tenant.published ? url : SETUP_HREF}
                key={url}
              >
                <span className={"step-circle " + (done ? "done" : "")}>
                  {done ? <Check size={15} /> : i + 1}
                </span>
                <span>{label}</span>
                <ChevronRight size={16} />
              </Link>
            ))
          )}
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <h2>{sub ? t("recentSessions") : "Needs you"}</h2>
          <Link
            href={sub ? "/app/progress" : "/trainer/exceptions"}
            className="text-link"
          >
            {sub ? t("viewAll") : "View all"} <ArrowUpRight size={14} />
          </Link>
        </div>
        {sub ? (
          workouts.length ? (
            workouts.slice(0, 4).map((w) => (
              <div className="list-row" key={w.id}>
                <span dir="auto">
                  {w.data.program?.title ?? t("workoutFallback")}
                </span>
                <Badge>{workoutStatusText(w.status, workoutT)}</Badge>
              </div>
            ))
          ) : (
            <Empty title={t("firstSession")} detail={t("firstSessionDetail")} />
          )
        ) : exceptions.length ? (
          exceptions.slice(0, 4).map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>{e.data.category.replaceAll("_", " ")}</strong>
                <p className="muted">{e.data.description}</p>
              </div>
              <Badge tone="amber">Needs review</Badge>
            </div>
          ))
        ) : (
          <Empty
            title="A little breathing room"
            detail="Anything that needs you will appear here, with what you need to act."
          />
        )}
      </Card>
    </>
  );
}
export function OnboardingView(props: ViewProps) {
  const step = props.path.split("/")[3] ?? "account";
  const child = step.startsWith("nutrition-") ? (
    <NutritionCoach
      initialSection={step.replace("nutrition-", "")}
      role={props.state.user.role}
    />
  ) : step === "brand" ? (
    <Brand {...props} />
  ) : ["interview", "uploads", "knowledge", "scenarios", "readiness"].includes(
      step,
    ) ? (
    <BrainView
      {...props}
      path={
        step === "readiness"
          ? "/trainer/brain/releases"
          : step === "scenarios"
            ? "/trainer/brain/scenarios"
            : "/trainer/brain"
      }
    />
  ) : step === "offer" ? (
    <Finance {...props} path="/trainer/products" />
  ) : step === "payout" ? (
    <PayoutView {...props} />
  ) : step === "share" ? (
    <>
      <ShareYourLink
        slug={props.state.tenant.slug}
        published={!!props.state.tenant.published}
      />
      <FollowerEstimate compact />
    </>
  ) : null;
  return (
    <Onboarding
      stepKey={step}
      key={step}
      revision={JSON.stringify([
        props.state.tenant.theme,
        props.state.records.map((r) => [r.id, r.version, r.status]),
      ])}
    >
      {child}
    </Onboarding>
  );
}
export function Brand({ state, onSaved }: ViewProps) {
  return (
    <TrainerDesign
      tenant={state.tenant}
      role={state.user.role}
      onSaved={onSaved}
    />
  );
}
