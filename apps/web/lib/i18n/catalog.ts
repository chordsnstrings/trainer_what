/**
 * Every subscriber message namespace. Each file holds one area's English
 * and Arabic side by side (`defineMessages`), so a missing Arabic key fails
 * the typecheck and tests/i18n.test.ts.
 */
import nav from "./messages/nav";
import common from "./messages/common";
import shell from "./messages/shell";
import pwa from "./messages/pwa";
import push from "./messages/push";
import errors from "./messages/errors";
import auth from "./messages/auth";
import join from "./messages/join";
import publicPages from "./messages/public";
import consent from "./messages/consent";
import site from "./messages/site";
import offers from "./messages/offers";
import workout from "./messages/workout";
import today from "./messages/today";
import profile from "./messages/profile";
import account from "./messages/account";
import prefs from "./messages/prefs";
import training from "./messages/training";
import connect from "./messages/connect";
import health from "./messages/health";
import support from "./messages/support";
import bookings from "./messages/bookings";
import context from "./messages/context";
import membership from "./messages/membership";
import voice from "./messages/voice";
import nutrition from "./messages/nutrition";
import capture from "./messages/capture";
import chat from "./messages/chat";
import plan from "./messages/plan";
export const CATALOG = {
  nav,
  common,
  shell,
  pwa,
  push,
  errors,
  auth,
  join,
  public: publicPages,
  consent,
  site,
  offers,
  workout,
  today,
  profile,
  account,
  prefs,
  training,
  connect,
  health,
  support,
  bookings,
  context,
  membership,
  voice,
  nutrition,
  capture,
  chat,
  plan,
} as const;

export type NamespaceName = keyof typeof CATALOG;
