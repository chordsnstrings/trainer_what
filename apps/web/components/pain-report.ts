/**
 * The description sent when a member stops a workout for pain
 * (POST /workouts/:id/pain needs at least 3 characters). Stopping is a
 * safety action, so it never waits for the member to write something:
 * an empty or very short note still stops the workout and tells the coach.
 */
export const PAIN_NO_DETAILS =
  "Pain or a problem during the workout. No details given.";
export function painDescription(text: string) {
  const note = text.trim();
  if (note.length >= 3) return note;
  return note
    ? `Pain or a problem during the workout: ${note}`
    : PAIN_NO_DETAILS;
}
