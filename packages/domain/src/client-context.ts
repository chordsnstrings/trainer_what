import { z } from "zod";

export const communicationStyles = {
  no_preference: "No preference",
  concise: "Keep it brief",
  detailed: "Explain step by step",
  encouraging: "Encouraging",
  direct: "Direct",
} as const;

const date = z.iso.date();
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone, for example Asia/Dubai");

export const datedClientContextSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["travel", "schedule"]),
    title: z.string().trim().min(1).max(120),
    startsOn: date,
    endsOn: date,
    timezone,
    availabilityNotes: z.string().trim().max(500),
    equipmentNotes: z.string().trim().max(500),
  })
  .strict()
  .refine((value) => value.endsOn >= value.startsOn, {
    message: "End date must be on or after the start date",
    path: ["endsOn"],
  });

export const clientContextSchema = z
  .object({
    communicationStyle: z.enum([
      "no_preference",
      "concise",
      "detailed",
      "encouraging",
      "direct",
    ]),
    communicationNotes: z.string().trim().max(1000),
    exerciseLikes: z.array(z.string().trim().min(1).max(100)).max(20),
    exerciseDislikes: z.array(z.string().trim().min(1).max(100)).max(20),
    datedChanges: z.array(datedClientContextSchema).max(8),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.datedChanges.map((change) => change.id)).size ===
      value.datedChanges.length,
    {
      message: "Each dated change must have a unique identifier",
      path: ["datedChanges"],
    },
  );

export type ClientContextData = z.infer<typeof clientContextSchema>;
export type DatedClientContext = z.infer<typeof datedClientContextSchema>;
export type ClientContextView = {
  id: string | null;
  version: number;
  data: ClientContextData;
  provenance: {
    source: "self_reported";
    userId: string;
    updatedAt: string | null;
  };
  allowedUses: ["render"];
};

export function emptyClientContext(): ClientContextData {
  return {
    communicationStyle: "no_preference",
    communicationNotes: "",
    exerciseLikes: [],
    exerciseDislikes: [],
    datedChanges: [],
  };
}

export function contextLocalDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

export function datedContextState(
  change: DatedClientContext,
  now = new Date(),
): "upcoming" | "active" | "past" {
  const today = contextLocalDate(change.timezone, now);
  return today < change.startsOn
    ? "upcoming"
    : today > change.endsOn
      ? "past"
      : "active";
}
