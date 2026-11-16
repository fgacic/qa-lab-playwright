import type { Locator, Page } from '@playwright/test';

/**
 * Where the keyboard focus is, which no role or text states: read in the page, behind a name, so a spec says what it waits for
 * or checks and not how the browser is asked.
 */

/** The focus is on `container` or on something inside it. */
export const focusWithin = (container: Locator): Promise<boolean> => container.evaluate((element) => element.contains(document.activeElement));

/**
 * Focusing `control` changes how it is drawn: its region, with a margin for a ring that sits outside the box, looks different
 * focused than blurred. WCAG 2.4.7 asks for a visible indicator, and a computed style cannot say that one is drawn (a ring can
 * be an outline, a shadow, a border, a background or a colour); the pixels can. Animations are finished on the spot, so a
 * ring that fades in is compared in its final state. Leaves the control blurred.
 */
export async function focusRingDrawn(page: Page, control: Locator): Promise<boolean> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('the control to be focused has no box: it is not drawn');
  const margin = 8;
  const clip = { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin };
  const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await control.focus();
  const focused = await shot();
  await control.blur();
  return !focused.equals(await shot());
}
