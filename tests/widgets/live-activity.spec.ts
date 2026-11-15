import { expect, mock, test, withMocks } from '@fixtures';
import { salesStream } from '@support/payloads';

/**
 * The panel is "Live" only while its EventSource is open. A mocked stream is a finite body: the browser
 * sees it end and drops back to "Reconnecting" with the connecting text, whatever it carried. So the mocked
 * tests assert what the stream delivered, and the one real feed (below) proves the "Live" state.
 */
const CONNECTING = 'Connecting to the live feed…';

/** The feed is Server-Sent Events. Mocking it with a fixed stream makes the panel deterministic. */
test.describe('Live shop activity', () => {
  // The real feed (a read-only GET) stays open, which no mocked body can: this is where the dot says "Live".
  test('connects to the shop\'s own feed and says it is live', async ({ homePage }) => {
    const { liveActivity } = homePage.shell;

    await liveActivity.open();

    await expect(liveActivity.connection).toHaveAttribute('title', 'Live');
  });

  test.describe('with no sales yet', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.eventStream('/sales-stream', salesStream([]))));

    test('opens empty and closes again', async ({ homePage }) => {
      const { liveActivity } = homePage.shell;

      await liveActivity.open();
      await expect(liveActivity.window).toBeVisible();
      await expect(liveActivity.emptyState).toHaveText(CONNECTING);
      await expect(liveActivity.items).toHaveCount(0);
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

      // The newest sale is listed first.
      await expect(liveActivity.items).toHaveText([/Qa Lab Saw/, /Qa Lab Hammer/]);
      await expect(liveActivity.salesCount).toHaveText('2');
      await expect(liveActivity.revenue).toHaveText('$50.50');
    });
  });

  test.describe('when the feed cannot be reached', { tag: ['@mocked', '@negative'] }, () => {
    test.use(withMocks(mock.abort('GET', '/sales-stream')));

    // The panel does not fail silently: it stays in its "connecting" state and the dot says it is retrying.
    test('the panel says it is still connecting and lists nothing', async ({ homePage }) => {
      const { liveActivity } = homePage.shell;

      await liveActivity.open();

      await expect(liveActivity.emptyState).toHaveText(CONNECTING);
      await expect(liveActivity.connection).toHaveAttribute('title', 'Reconnecting');
      await expect(liveActivity.items).toHaveCount(0);
      await expect(liveActivity.salesCount).toHaveText('0');
    });
  });

  test.describe('when the feed drops and comes back', { tag: ['@mocked'] }, () => {
    // An established stream that ends is a dropped connection: every browser reconnects after the stream's own retry delay,
    // which is what the second answer serves. (A request that never connects is not retried by Firefox, so it would not be a drop.)
    test.use(withMocks(mock.sequence('GET', '/sales-stream',
      { status: 200, contentType: 'text/event-stream', body: salesStream([], 300) },
      { status: 200, contentType: 'text/event-stream', body: salesStream([{ name: 'Qa Lab Hammer', quantity: 1, unit_price: 10.5, buyer: 'Testy', city: 'Testville' }]) })));

    test('the sales that arrive after the reconnect are listed', async ({ homePage }) => {
      const { liveActivity } = homePage.shell;

      await liveActivity.open();

      await expect(liveActivity.items).toHaveText([/Qa Lab Hammer/]);
      await expect(liveActivity.salesCount).toHaveText('1');
    });
  });
});
