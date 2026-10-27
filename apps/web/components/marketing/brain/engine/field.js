/* The field and the board's runtime: a stub until WP2 ports it (docs/marketing-revamp-
   2026-10-26/phase1/PLAN.md §2). It never sets data-sc="on", so the island's
   fallback ends the root at "off": the still frame. */

/** Mounts on the root (brain/mount.tsx calls it after load, idle and near). */
export async function mount(root, o) {
  return {
    destroy() {},
  };
}
