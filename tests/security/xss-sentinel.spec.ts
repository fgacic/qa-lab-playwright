import { expect, test } from '@fixtures';
import { ATTRIBUTE_XSS_PAYLOAD, OBSERVATION_WINDOW_MS, ROUTE_XSS_PAYLOADS, XSS_PAYLOADS } from '@fixtures/security';

/**
 * Positive control for the other security specs. A "nothing ran" result only means something if
 * the sentinel can see a payload run, so each payload is put into the page the way a vulnerable
 * sink would and must be detected, in the page itself, in a popup and in a tab of its own. Runs on
 * both targets: it touches only the pages it opened, except the visitor control at the end (self-hosted only).
 */
test.describe('XSS sentinel (positive control)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  // Both forms of each attack: with a call in parentheses, and as a tagged template (what fits in a URL).
  const everyPayload = [...Object.entries(XSS_PAYLOADS), ...Object.entries(ROUTE_XSS_PAYLOADS).map(([name, payload]) => [`${name}, as a tagged template`, payload] as const)];

  for (const [name, payload] of everyPayload) {
    test(`detects ${name} when a page parses it as HTML`, async ({ homePage, xss }) => {
      await expect(homePage.grid.cards.first(), 'the page is loaded before anything is injected').toBeVisible();
      expect(xss.executions(), 'nothing has run before the payload is injected').toEqual([]);

      await xss.parseInFrame(payload);

      await expect.poll(() => xss.executions(), 'the sentinel saw the payload run').not.toEqual([]);
      await expect(xss.expectNotExecuted(), 'the negative check fails once something ran').rejects.toThrow(/script ran on the page/);
    });
  }

  for (const [name, payload] of everyPayload) {
    test(`counts the element a ${name} payload leaves in the page`, async ({ homePage, xss }) => {
      await expect(homePage.grid.cards.first(), 'the page is loaded before anything is injected').toBeVisible();
      await xss.expectNoInjectedElements();

      await xss.insertHtml(payload);

      await expect.poll(() => xss.injectedCount(), { message: 'the payload left exactly one element' }).toBe(1);
    });
  }

  // Only the <img> payloads wait on a load: a script or an svg handler would have run (or not) the moment it was inserted.
  const imagePayloads = everyPayload.filter(([, payload]) => payload.startsWith('<img'));
  for (const [name, payload] of imagePayloads) {
    // The sentinel's wait for pending images must not take over the image's own handlers: an `<img onerror=...>` payload runs through
    // `onerror`, and a wait that assigned that property would silence it, so the check would pass on a payload that ran.
    test(`detects ${name} that only runs once a slow image fails`, async ({ homePage, xss }) => {
      // Longer than the observation window: a check that only watched the window would see a quiet page and pass, so it fails
      // here unless it first waits for the pending image (and, once the image failed, sees the handler that ran).
      const IMAGE_LATENCY_MS = OBSERVATION_WINDOW_MS + 500;
      await homePage.page.route('**/x', async (route) => {
        // Latency, not a wait: the image is still loading when the negative check starts, so the check has to wait for it.
        // The body is not an image, so it fails to decode and fires `error` (a 404 would also log a console error the guard rejects).
        await new Promise((answered) => setTimeout(answered, IMAGE_LATENCY_MS));
        await route.fulfill({ status: 200, contentType: 'image/png', body: 'not an image' });
      });
      await xss.insertHtml(payload);

      await expect(xss.expectNotExecuted(), 'the negative check waited for the slow image and saw its handler run').rejects.toThrow(/script ran on the page/);
    });
  }

  // The attribute payload is not HTML on its own (it is text until it lands inside a quoted attribute), so it gets its own control.
  test('detects a payload that breaks out of an attribute, and counts the element it leaves', async ({ homePage, xss }) => {
    await expect(homePage.grid.cards.first(), 'the page is loaded before anything is injected').toBeVisible();
    await xss.insertAsAttributeValue(ATTRIBUTE_XSS_PAYLOAD);

    await expect.poll(() => xss.injectedCount(), { message: 'the input that grew an onfocus attribute is one parsed payload' }).toBe(1);
    await expect.poll(() => xss.executions(), 'autofocus ran the handler').toEqual(['7']);
  });

  test('counts payloads left inside an iframe and a shadow root', async ({ homePage, xss }) => {
    await expect(homePage.grid.cards.first(), 'the page is loaded before anything is injected').toBeVisible();
    await xss.insertInFrameAndShadowRoot('<img src="x">', '<svg onload="__qaLabXssHit(9)"></svg>');

    await expect.poll(() => xss.injectedCount(), { message: 'one payload in the frame and one in the shadow root' }).toBe(2);
  });

  // The sentinel's wrappers and hook are installed on the context before the first navigation. A payload that runs while
  // the page is still loading, from an inline script, is the case that proves it: a late install would miss it.
  test('detects an alert called by an inline script while the page loads', async ({ page, xss }) => {
    await page.route('**/xss-install-order-control', (route) =>
      route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>control</title><script>alert('during load'); __qaLabXssHit('hook during load');</script>` }),
    );

    await page.goto('/xss-install-order-control');

    await expect.poll(() => xss.executions(), 'both calls made during load were recorded').toEqual(['alert: during load', 'hook during load']);
  });

  test('detects a dialog opened by page script', async ({ homePage, xss }) => {
    await expect(homePage.grid.cards.first(), 'the page is loaded before anything is injected').toBeVisible();
    await xss.raiseAlert('anything');

    await expect.poll(() => xss.executions(), 'the alert was recorded').toEqual(['alert: anything']);
  });

  test('detects a dialog opened in a popup the page opened', async ({ homePage, xss }) => {
    await expect(homePage.grid.cards.first(), 'the page is loaded before anything is injected').toBeVisible();
    const popup = await xss.openPopup('/contact');

    await xss.raiseAlert('in a popup', popup);

    await expect.poll(() => xss.executions(), 'the alert in the popup was recorded').toEqual(['alert: in a popup']);
  });

  test('detects a dialog opened in a tab of its own', async ({ homePage, xss }) => {
    const tab = await homePage.page.context().newPage();
    await tab.goto('/contact');

    await xss.raiseAlert('in another tab', tab);

    await expect.poll(() => xss.executions(), 'the alert in the other tab was recorded').toEqual(['alert: in another tab']);
  });
});

/** The visitor of the stored-input specs is somebody else's browser context: the sentinel must see a payload run there too. */
test.describe('XSS sentinel on another visitor (positive control, self-hosted only)', { tag: ['@security', '@self-hosted'] }, () => {
  test.use({ xssWatch: true });

  test('detects a dialog opened for a visitor with a context of their own', async ({ visitorContactPage, xss }) => {
    await xss.raiseAlert('for the visitor', visitorContactPage.page);

    await expect.poll(() => xss.executions(), "the alert in the visitor's context was recorded").toEqual(['alert: for the visitor']);
  });
});
