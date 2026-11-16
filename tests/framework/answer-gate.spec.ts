// The positive control of the double-submit pins (BUG-46, BUG-53): src/support/answer-gate.ts, on a page that has no defect to
// find. If `dblclick()` stopped delivering two clicks on an engine, or the gate stopped holding the answer back, the pins would
// pass or fail for the wrong reason; here an unguarded handler must be reached twice on every engine, a guarded one once.
import { chromium, expect, firefox, test, webkit } from '@playwright/test';
import { holdAnswers } from '@support/answer-gate';
import { httpsUrl } from '@support/urls';

const ORDER = httpsUrl('shop.qa-lab.test', '/order');
const ENGINES = { chromium, firefox, webkit };

/** A page whose button posts an order and, if `guarded`, refuses a second click until the answer is in. */
const orderPage = (guarded: boolean) => `
  <button id="confirm">Confirm</button><p id="done" hidden>Thanks</p>
  <script>
    let busy = false;
    document.getElementById('confirm').addEventListener('click', async () => {
      if (${guarded} && busy) return;
      busy = true;
      await fetch('${ORDER}', { method: 'POST' });
      document.getElementById('confirm').remove();
      document.getElementById('done').hidden = false;
    });
  </script>`;

test.describe('the answer gate', { tag: ['@framework'] }, () => {
  for (const [name, engine] of Object.entries(ENGINES)) {
    for (const guarded of [false, true]) {
      test(`on ${name}, a double click reaches ${guarded ? 'a guarded handler once' : 'an unguarded handler twice'} while the answer is held`, async () => {
        const browser = await engine.launch();
        try {
          const page = await browser.newPage();
          const order = await holdAnswers(page, /\/order$/, { ok: true });
          await page.setContent(orderPage(guarded));

          await page.getByRole('button', { name: 'Confirm' }).dblclick();
          order.release();

          await expect(page.getByText('Thanks')).toBeVisible();
          expect(order.reached, guarded ? 'the guard lets one order through' : 'both clicks reach the handler').toBe(guarded ? 1 : 2);
        } finally {
          await browser.close();
        }
      });
    }
  }
});
