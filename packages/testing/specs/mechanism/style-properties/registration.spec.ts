/**
 * The numeric custom properties the script writes and the sheets animate are
 * registered before anything transitions them: each registration keeps the
 * syntax it declares and an initial value written in that syntax, its write
 * reaches the reader below it, and the property crosses the values in between
 * during an animation. Left unregistered, the same write is a token stream the
 * browser cannot animate, and a transition steps between its two ends.
 *
 * @capability style-properties
 * @features shared
 * @risk A registration whose initial value does not match its syntax is dropped whole, so the effort names, the sliding pill, the caret preview and the reading's colour band take the write as a token stream again and step through their transitions instead of crossing them.
 */
import { expect, test } from 'vitest'
import { themePropertiesCss } from '@dsh-claude-ui/client/pure'

/** What a registration may declare, with a write of each and the value it resolves to. */
const SYNTAXES: Record<string, { arithmetic: string, resolved: string, from: string, to: string, middle: string }> = {
  '<number>': { arithmetic: 'calc(0.25 + 0.25)', resolved: '0.5', from: '0', to: '1', middle: '0.5' },
  '<length>': { arithmetic: 'calc(2px + 3px)', resolved: '5px', from: '0px', to: '100px', middle: '50px' },
  '<percentage>': { arithmetic: 'calc(10% + 10%)', resolved: '20%', from: '0%', to: '10%', middle: '5%' },
}

/** The sheet's own registrations, read from the CSSOM rather than from its text. */
let sheet: HTMLStyleElement | null = null
function registrations(): CSSPropertyRule[] {
  if (sheet === null) {
    sheet = document.createElement('style')
    sheet.textContent = themePropertiesCss
    // The sheet stays in the page for the file's tests: the registrations are
    // what the animations below read.
    document.head.append(sheet)
  }
  return [...(sheet.sheet?.cssRules ?? [])].filter((rule): rule is CSSPropertyRule => rule instanceof CSSPropertyRule)
}

/** The value the browser computes for a property on an element. */
function read(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim()
}

test('a write resolves under the registered syntax and reaches the reader below it', () => {
  const registered = registrations()
  expect(registered.length).toBeGreaterThan(0)
  const box = document.createElement('div')
  const reader = document.createElement('span')
  box.append(reader)
  document.body.append(box)
  for (const rule of registered) {
    const syntax = SYNTAXES[rule.syntax]
    if (syntax === undefined) throw new Error(`${rule.name} registers ${rule.syntax}, which this spec does not know`)
    // The initial value is the value a fresh element reads, so it parses under
    // the syntax the same rule declares (a mismatch drops the registration).
    const fresh = document.createElement('div')
    document.body.append(fresh)
    expect(read(fresh, rule.name), rule.name).toBe(rule.initialValue)
    fresh.remove()
    // The write resolves at computed-value time, which an unregistered custom
    // property never does — and every reader of these stands below the write.
    box.style.setProperty(rule.name, syntax.arithmetic)
    void reader.offsetWidth
    expect(read(reader, rule.name), rule.name).toBe(syntax.resolved)
  }
  box.remove()
})

test('a registered property crosses the middle of an animation', async () => {
  const box = document.createElement('div')
  const probe = document.createElement('span')
  box.append(probe)
  document.body.append(box)
  for (const rule of registrations()) {
    const syntax = SYNTAXES[rule.syntax]
    if (syntax === undefined) throw new Error(`${rule.name} registers ${rule.syntax}, which this spec does not know`)
    const animation = probe.animate([{ [rule.name]: syntax.from }, { [rule.name]: syntax.to }], { duration: 200, easing: 'linear', fill: 'both' })
    animation.pause()
    animation.currentTime = 100
    await animation.ready
    expect(read(probe, rule.name), rule.name).toBe(syntax.middle)
    animation.cancel()
  }
  box.remove()
})
