/**
 * A chevron for the skin's own folds: one path, drawn in the current ink, its
 * square size the box the surrounding control gives it. The rail's fold, a
 * section header's and a fork's source all draw the same shape at different
 * sizes, so the drawing waits here instead of in each feature.
 *
 * @param d - the path's own drawing.
 * @param size - the square size in CSS pixels.
 */
export function buildChevron(d: string, size: number) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('width', String(size))
  icon.setAttribute('height', String(size))
  icon.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  icon.append(path)
  return icon
}
