import type { Locator, Page } from '@playwright/test';

/**
 * Where the keyboard focus is, which no role or text states: read in the page, behind a name, so a spec says what it waits for
 * or checks and not how the browser is asked.
 */

/** The focus is on `container` or on something inside it. */
export const focusWithin = (container: Locator): Promise<boolean> => container.evaluate((element) => element.contains(document.activeElement));

/** How far outside the control's box a ring is looked for, and how far inside its edge: an outline, a shadow or a border all fall in this band. */
const OUTSIDE = 8;
const INSIDE = 3;

/**
 * Focusing `control` draws a ring around it: pixels differ between its blurred and its focused state along all four sides of its box
 * (outside the edge, where an outline or a shadow sits, and a few pixels inside it, where a border or a background reaches). WCAG
 * 2.4.7 asks for a visible indicator, and a computed style cannot say that one is drawn (a ring can be an outline, a shadow, a border,
 * a background or a colour); the pixels can. Pixels that change in only one place (a label's colour in the middle of the control, a tooltip
 * on one side, a sibling that moves) are not a ring. The blurred state is read twice first, and a region that differs between those two
 * reads (something animating, a caret) is a region the comparison cannot trust: the check throws instead of guessing.
 * Animations are finished on the spot, so a ring that fades in is compared in its final state. Leaves the control blurred.
 */
export async function focusRingDrawn(page: Page, control: Locator): Promise<boolean> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('the control to be focused has no box: it is not drawn');
  const clip = { x: Math.max(0, box.x - OUTSIDE), y: Math.max(0, box.y - OUTSIDE), width: box.width + 2 * OUTSIDE, height: box.height + 2 * OUTSIDE };
  const shot = async () => (await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })).toString('base64');
  await control.blur();
  const blurred = await shot();
  if (blurred !== (await shot())) throw new Error('the region around the control changes on its own while it is blurred: a ring cannot be told from it');
  await control.focus();
  const focused = await shot();
  await control.blur();
  // The box inside the clip (the clip may start short of the margin at the page's edge).
  const inner = { x: box.x - clip.x, y: box.y - clip.y, width: box.width, height: box.height };
  return page.evaluate(
    async ({ before, after, inner, outside, inside }) => {
      const pixels = async (png: string) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [a, b] = await Promise.all([pixels(before), pixels(after)]);
      const differs = (x: number, y: number) => {
        const at = (y * a.width + x) * 4;
        return [0, 1, 2, 3].some((channel) => a.data[at + channel] !== b.data[at + channel]);
      };
      // One strip per side: from `outside` px beyond the edge to `inside` px within it, along the whole side.
      const left = Math.round(inner.x), top = Math.round(inner.y);
      const right = Math.round(inner.x + inner.width), bottom = Math.round(inner.y + inner.height);
      const strips = [
        { x0: left - outside, x1: right + outside, y0: top - outside, y1: top + inside, length: right - left },
        { x0: left - outside, x1: right + outside, y0: bottom - inside, y1: bottom + outside, length: right - left },
        { x0: left - outside, x1: left + inside, y0: top - outside, y1: bottom + outside, length: bottom - top },
        { x0: right - inside, x1: right + outside, y0: top - outside, y1: bottom + outside, length: bottom - top },
      ];
      return strips.every(({ x0, x1, y0, y1, length }) => {
        let count = 0;
        for (let y = Math.max(0, y0); y < Math.min(a.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(a.width, x1); x++) if (differs(x, y)) count++;
        // At least one full line of pixels along the side: a ring is that long, a stray mark is not.
        return count >= length;
      });
    },
    { before: blurred, after: focused, inner, outside: OUTSIDE, inside: INSIDE },
  );
}
