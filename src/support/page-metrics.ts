import { type Page } from '@playwright/test';

/**
 * What the layout does, which no role or text states: read in the page, behind a name, so a spec says what it waits for or
 * checks and not how the browser is asked.
 */

/** Pixels the page is wider than its viewport: more than 0 is sideways scrolling (WCAG 1.4.10 reflow at a narrow width). */
export const horizontalOverflow = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * The text spacing WCAG 1.4.12 says a page must survive without losing content: line height 1.5 times the font size, paragraph
 * spacing 2 times, letter spacing 0.12 times and word spacing 0.16 times. `!important`, as a user's stylesheet or an extension applies it.
 */
export async function applyTextSpacing(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }',
  });
}

/**
 * The elements whose text is cut off by their own box: they hide what overflows (`overflow: hidden` or `clip`, which no scrollbar
 * undoes) and hold more than they show, in width or height. Each is named by its tag, test id and the start of its text, sorted, so
 * two reads of one page can be compared and what changed between them is the difference. Boxes that scroll (`auto`, `scroll`) are not
 * listed: their content stays reachable.
 */
export const clippedText = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const named = (element: Element) => `${element.tagName.toLowerCase()}${element.getAttribute('data-test') ? `[${element.getAttribute('data-test')}]` : ''} "${(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    return [...document.body.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const hides = (value: string) => value === 'hidden' || value === 'clip';
        if (!hides(style.overflowX) && !hides(style.overflowY)) return false;
        if (style.display === 'none' || !(element.textContent ?? '').trim()) return false;
        return (hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1) || (hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1);
      })
      .map(named)
      .sort();
  });
