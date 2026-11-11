/**
 * The sidebar's width, as the host keeps it: the layout stores one number that
 * is both the open width and the closed state (`0` is closed), and its own
 * toggle opens at the default width every time. A reader who narrows the
 * sidebar keeps that width only while it stands open; these two helpers are
 * what the feature reads to bring the reader's width back on the next open.
 */

/** The narrowest width the host's own drag accepts. */
export const SIDEBAR_MIN_WIDTH = 264
/** The widest width the host's own drag accepts. */
export const SIDEBAR_MAX_WIDTH = 420
/** The width the host opens at when nothing else is said. */
export const SIDEBAR_DEFAULT_WIDTH = 280

/**
 * The width a stored number names, if it is one the host's drag could have
 * left behind: the open range, never the closed state or a broken value.
 *
 * @param px - the number read back from the reader's store.
 * @returns the width to remember, or null for a value that names none.
 */
export function rememberedWidth(px: number | null): number | null {
  if (px === null || !Number.isFinite(px)) return null
  const width = Math.round(px)
  if (width < SIDEBAR_MIN_WIDTH || width > SIDEBAR_MAX_WIDTH) return null
  return width
}

/**
 * The width to put back on the next open: the reader's own width when they have
 * one and the host opened at its default, and nothing when the width already
 * stands where the reader left it (or the reader never narrowed it).
 *
 * @param current - the width the sidebar stands at now.
 * @param remembered - the reader's own width, as rememberedWidth answered.
 * @returns the width to write, or null when the open needs no correction.
 */
export function restoredWidth(current: number, remembered: number | null): number | null {
  if (remembered === null) return null
  if (Math.round(current) === remembered) return null
  return remembered
}
