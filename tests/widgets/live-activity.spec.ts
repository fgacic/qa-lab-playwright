import { expect, mock, test, withMocks } from '@fixtures';
import { salesStream } from '@support/payloads';

/** The feed is Server-Sent Events. Mocking it with a fixed stream makes the panel deterministic. */
test.describe('Live shop activity', () => {
  test.describe('with no sales yet', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.eventStream('/sales-stream', salesStream([]))));

    test('opens empty and closes again', async ({ homePage }) => {
      const { liveActivity } = homePage.shell;

      await liveActivity.open();
      await expect(liveActivity.window).toBeVisible();
      await expect(liveActivity.salesCount).toHaveText('0');
      await expect(liveActivity.revenue).toHaveText('$0.00');

      await liveActivity.close();
      await expect(liveActivity.window).toBeHidden();
    });
  });

  test.describe('when sales come in', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.eventStream('/sales-stream', salesStream([
      { name: 'Qa Lab Hammer', quantity: 1, unit_price: 10.5, buyer: 'Testy', city: 'Testville' },
      { name: 'Qa Lab Saw', quantity: 2, unit_price: 20, buyer: 'Botty', city: 'Mockstad' },
    ]))));

    test('each sale is listed and the counters add up', async ({ homePage }) => {
      const { liveActivity } = homePage.shell;

      await liveActivity.open();

      await expect(liveActivity.items).toHaveCount(2);
      await expect(liveActivity.items.first()).toContainText('Qa Lab Saw');
      await expect(liveActivity.salesCount).toHaveText('2');
      await expect(liveActivity.revenue).toHaveText('$50.50');
    });
  });
});
