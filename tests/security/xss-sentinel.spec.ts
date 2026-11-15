import { expect, test } from '@fixtures';
import { ROUTE_XSS_PAYLOADS, XSS_PAYLOADS } from '@fixtures/security';

/**
 * Positive control for the other security specs. A "nothing ran" result only means something if
 * the sentinel can see a payload run, so each payload is put into the page the way a vulnerable
 * sink would and must be detected, in the page itself, in a popup and in a tab of its own. Runs on
 * both targets: it touches only the pages it opened.
 */
test.describe('XSS sentinel (positive control)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  // Both forms of each attack: with a call in parentheses, and as a tagged template (what fits in a URL).
  const everyPayload = [...Object.entries(XSS_PAYLOADS), ...Object.entries(ROUTE_XSS_PAYLOADS).map(([name, payload]) => [`${name}, as a tagged template`, payload] as const)];

  for (const [name, payload] of everyPayload) {
    test(`detects ${name} when a page parses it as HTML`, async ({ homePage, xss }) => {
      expect(xss.executions(), 'nothing has run before the payload is injected').toEqual([]);

      // A frame's srcdoc is parsed as a document, which is what makes <script> and <svg onload> run.
      await homePage.page.evaluate((html) => {
        const frame = document.createElement('iframe');
        frame.srcdoc = html;
        document.body.append(frame);
      }, payload);

      await expect.poll(() => xss.executions(), 'the sentinel saw the payload run').not.toEqual([]);
      await expect(xss.expectNotExecuted(), 'the negative check fails once something ran').rejects.toThrow(/script ran on the page/);
    });
  }

  for (const [name, payload] of everyPayload) {
    test(`counts the element a ${name} payload leaves in the page`, async ({ homePage, xss }) => {
      await xss.expectNoInjectedElements();

      await homePage.page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), payload);

      await expect.poll(() => xss.injectedCount(), { message: 'the payload left exactly one element' }).toBe(1);
    });
  }

  test('detects a dialog opened by page script', async ({ homePage, xss }) => {
    await homePage.page.evaluate(() => window.alert('anything'));

    await expect.poll(() => xss.executions(), 'the alert was recorded').toEqual(['alert: anything']);
  });

  test('detects a dialog opened in a popup the page opened', async ({ homePage, xss }) => {
    const opened = homePage.page.waitForEvent('popup');
    await homePage.page.evaluate(() => window.open('/contact', '_blank'));
    const popup = await opened;
    await popup.waitForLoadState('domcontentloaded');

    await popup.evaluate(() => window.alert('in a popup'));

    await expect.poll(() => xss.executions(), 'the alert in the popup was recorded').toEqual(['alert: in a popup']);
  });

  test('detects a dialog opened in a tab of its own', async ({ homePage, xss }) => {
    const tab = await homePage.page.context().newPage();
    await tab.goto('/contact');

    await tab.evaluate(() => window.alert('in another tab'));

    await expect.poll(() => xss.executions(), 'the alert in the other tab was recorded').toEqual(['alert: in another tab']);
  });
});
