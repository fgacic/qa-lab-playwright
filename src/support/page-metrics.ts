import { expect, type Page } from '@playwright/test';

/**
 * What the layout does, which no role or text states: read in the page, behind a name, so a spec says what it waits for or
 * checks and not how the browser is asked.
 */

/** Pixels the page is wider than its viewport: more than 0 is sideways scrolling (WCAG 1.4.10 reflow at a narrow width). */
export const horizontalOverflow = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Every image the page has requested is decoded: a shot taken before it would record a hole where the picture goes. */
export async function expectImagesLoaded(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((image) => image.currentSrc !== '').every((image) => image.complete && image.naturalWidth > 0)), {
      message: 'every image to be loaded before the screenshot',
    })
    .toBe(true);
}
