import { expect, test } from '@fixtures';
import { ADMIN_SKIP_REASON, RUN_ADMIN_TESTS } from '@support/env';
import { fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Real back-office journeys against the live admin API, signed in from the `admin` project's
 * storageState. Gated: they create, change and delete data on a public shop. Run with
 *   RUN_ADMIN_TESTS=1 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:admin
 * Everything a test creates carries a unique "Qa Lab" name and is removed in teardown.
 */
test.skip(!RUN_ADMIN_TESTS, ADMIN_SKIP_REASON);
test.use({ adminSession: 'storage-state' });

test.describe('Back office, live', { tag: ['@admin'] }, () => {
  test.describe('a product', () => {
    const name = `Qa Lab Product ${Date.now().toString(36)}`;

    test.afterEach(async ({ api, adminToken }) => {
      const leftover = await api.findProductByName(adminToken, name);
      if (leftover) await api.deleteProduct(adminToken, leftover.id);
    });

    test('created in the back office is sold in the shop, repriced, then deleted', { tag: ['@flow'] }, async ({ adminProducts, homePage, page }) => {
      const form = await adminProducts.add();
      await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '3', price: '12.34' });
      await form.chrome.save();
      await expect(form.chrome.alert('Product saved!')).toBeVisible();

      await homePage.open();
      await homePage.search.searchFor(name);
      await expect(homePage.grid.card(name).price).toHaveText('$12.34');

      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      const edit = await adminProducts.edit(name);
      await edit.stock.fill('3'); // the edit form does not load the stock (ADM-05)
      await edit.price.fill('23.45');
      await edit.chrome.save();
      await expect(edit.chrome.alert('Product saved!')).toBeVisible();

      await homePage.open();
      await homePage.search.searchFor(name);
      await expect(homePage.grid.card(name).price).toHaveText('$23.45');

      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      await adminProducts.table.delete(name);
      await expect(adminProducts.feedback.filter({ hasText: 'Product deleted.' })).toBeVisible();
      await homePage.open();
      await homePage.search.searchFor(name);
      await expect(homePage.grid.emptyState).toBeVisible();
      await expect(page).toHaveURL('/');
    });
  });

  test('an order placed by a guest can be marked as shipped', async ({ api, catalog, adminOrders }) => {
    const { invoice_number } = await api.placeGuestOrder([{ product: await catalog.inStock(), quantity: 1 }], fakeGuest());

    await adminOrders.search.searchFor(invoice_number);
    const order = await adminOrders.edit(invoice_number);
    await order.updateStatus('SHIPPED');
    await expect(order.feedback.filter({ hasText: 'Status updated!' })).toBeVisible();

    await order.page.reload();
    await expect(order.status).toHaveValue('SHIPPED');
  });

  test('a contact message arrives in the inbox and can be taken in progress', async ({ api, adminMessages }) => {
    const sender = `Qa Lab Sender ${Date.now().toString(36)}`;
    const text = `Sent by the qa-lab suite at ${new Date().toISOString()}, long enough to be a real message.`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('contact'), subject: 'webmaster', message: text });

    await adminMessages.open();
    const message = await adminMessages.details(sender);
    await expect(message.text(text)).toBeVisible();
    await message.setStatus('IN_PROGRESS');

    await message.page.reload();
    await expect(message.status).toHaveValue('IN_PROGRESS');
  });

  test('the statistics render from real data', async ({ adminStatistics }) => {
    await expect(adminStatistics.heading).toBeVisible();
    await expect(adminStatistics.report('Top 10 Most Purchased Products').first()).toBeVisible();
  });

  test('the monthly sales chart renders from real data', async ({ adminMonthlySales }) => {
    await expect(adminMonthlySales.heading).toBeVisible();
    await expect(adminMonthlySales.chart).toBeVisible();
  });
});
