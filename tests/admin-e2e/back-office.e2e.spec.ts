import { expect, test } from '@fixtures';
import { ADMIN_SKIP_REASON, RUN_ADMIN_TESTS } from '@support/env';
import { knownBug } from '@support/known-bug';
import { fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Real back-office journeys against the real admin API, signed in from the `admin` project's
 * storageState (the seeded admin on the self-hosted Toolshop). They create, change and delete
 * data, so on the live site they only run with RUN_ADMIN_TESTS=1 and ADMIN_EMAIL / ADMIN_PASSWORD.
 * Everything a test creates carries a unique "QaLab" name and is removed in teardown.
 */
test.skip(!RUN_ADMIN_TESTS, ADMIN_SKIP_REASON);
test.use({ adminSession: 'storage-state' });

test.describe('Back office, real backend', { tag: ['@admin'] }, () => {
  test.describe('a product', () => {
    // No word under three letters: search requires every word, and MariaDB's full-text index
    // ignores short ones (BUG-28, pinned below).
    const name = `QaLab Product ${Date.now().toString(36)}`;

    test.afterEach(async ({ api, adminToken }) => {
      const leftover = await api.findProductByName(adminToken, name);
      if (leftover) await api.deleteProduct(adminToken, leftover.id);
    });

    test('created in the back office is sold in the shop, repriced, then deleted', { tag: ['@flow'] }, async ({ adminProducts, shop, page }) => {
      const form = await adminProducts.add();
      await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '3', price: '12.34' });
      await form.chrome.save();
      await expect(form.chrome.alert('Product saved!')).toBeVisible();

      await shop.home.open();
      await shop.home.search.searchFor(name);
      await expect(shop.home.grid.card(name).price).toHaveText('$12.34');

      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      const edit = await adminProducts.edit(name);
      // Wait for the form to load the product, or the load overwrites what is typed.
      await expect(edit.name).toHaveValue(name);
      // The edit form loads neither the stock (ADM-05) nor brand and category (ADM-09).
      await edit.stock.fill('3');
      await edit.brand.selectOption({ index: 1 });
      await edit.category.selectOption({ index: 1 });
      await edit.price.fill('23.45');
      await edit.chrome.save();
      await expect(edit.chrome.alert('Product saved!')).toBeVisible();

      await shop.home.open();
      await shop.home.search.searchFor(name);
      await expect(shop.home.grid.card(name).price).toHaveText('$23.45');

      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      await adminProducts.table.delete(name);
      await expect(adminProducts.feedback.filter({ hasText: 'Product deleted.' })).toBeVisible();
      await shop.home.open();
      await shop.home.search.searchFor(name);
      await expect(shop.home.grid.emptyState).toBeVisible();
      await expect(page).toHaveURL('/');
    });
  });

  test.describe('a product with a short word in its name', () => {
    const name = `Set of QaLab Pliers ${Date.now().toString(36)}`;

    test.afterEach(async ({ api, adminToken }) => {
      const listed = await api.listProducts({ sort: 'name,asc' });
      const leftover = listed.data.find((p) => p.name === name) ?? (await api.findProductByName(adminToken, name));
      if (leftover) await api.deleteProduct(adminToken, leftover.id);
    });

    test('is found by its full name', { tag: ['@bug'] }, async ({ adminProducts, shop }) => {
      knownBug('BUG-28', 'searching a product by its full name finds nothing when the name has a word under 3 letters ("of"): every word is required, but the full-text index drops short words.');
      const form = await adminProducts.add();
      await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '1', price: '5.00' });
      await form.chrome.save();
      await expect(form.chrome.alert('Product saved!')).toBeVisible();

      await shop.home.open();
      await shop.home.search.searchFor(name);

      await expect(shop.home.grid.card(name).root).toBeVisible({ timeout: 5_000 });
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
