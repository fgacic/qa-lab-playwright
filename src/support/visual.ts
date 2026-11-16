import { expect, type Page } from '@playwright/test';

/**
 * Every picture of the page is decoded before a screenshot is taken. The shop's grids load their pictures lazily
 * (`loading="lazy"`): one below the fold has a `src` but no `currentSrc` until it is near the viewport, so a check that
 * looks only at pictures already requested passes before they are even asked for, and the shot races their load.
 * The lazy ones are made eager first (the page's own wait, not a change to what is drawn), then each picture with a
 * `src` must be complete and have a width. Named `settle…`, not `expect…`: it waits, the screenshot is the assertion.
 */
export async function settleImages(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((image) => image.setAttribute('loading', 'eager')));
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((image) => image.getAttribute('src')).every((image) => image.complete && image.naturalWidth > 0)), {
      message: 'every picture, lazy ones included, to be loaded before the screenshot',
    })
    .toBe(true);
}
