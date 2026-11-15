import { expect, test } from '@fixtures';
import { XSS_PAYLOADS } from '@fixtures/security';

/**
 * Positive control for the other security specs. A "nothing ran" result only means something if
 * the sentinel can see a payload run, so each payload is put into the page the way a vulnerable
 * sink would and must be detected. Runs on both targets: it touches only the page it opened.
 */
test.describe('XSS sentinel (positive control)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  for (const [name, payload] of Object.entries(XSS_PAYLOADS)) {
    test(`detects ${name} when a page parses it as HTML`, async ({ homePage, xss }) => {
      expect(xss.executions(), 'nothing has run before the payload is injected').toEqual([]);

      // A frame's srcdoc is parsed as a document, which is what makes <script> and <svg onload> run.
      await homePage.page.evaluate((html) => {
        const frame = document.createElement('iframe');
        frame.srcdoc = html;
        document.body.append(frame);
      }, payload);

      await expect.poll(() => xss.executions(), 'the sentinel saw the payload run').not.toEqual([]);
      await expect(xss.expectNotExecuted(), 'the negative check fails once something ran').rejects.toThrow();
    });
  }

  test('counts the elements a payload leaves in the page', async ({ homePage, xss }) => {
    await xss.expectNoInjectedElements();

    await homePage.page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), XSS_PAYLOADS['img onerror']);

    expect(await xss.injectedCount()).toBe(1);
  });

  test('detects a dialog opened by page script', async ({ homePage, xss }) => {
    await homePage.page.evaluate(() => window.alert('anything'));

    await expect.poll(() => xss.executions(), 'the alert was recorded').toEqual(['alert: anything']);
  });
});
