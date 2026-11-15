import { randomUUID } from 'node:crypto';
import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Real back-office journeys against the real admin API, signed in from the `admin` project's
 * storageState (the seeded admin on the self-hosted Toolshop). They create, change and delete
 * data, so on the live site they only run with RUN_ADMIN_TESTS=1 and ADMIN_EMAIL / ADMIN_PASSWORD.
 * Every product a test creates carries a unique "QaLab" name, and its id is taken from the
 * create response and deleted by id in teardown (`createdProducts`), pass or fail. The API
 * cannot delete a guest order or a contact message (DELETE /invoices/{id} and /messages/{id}
 * answer 405), so those two tests leave one uniquely named record each behind: harmless on the
 * throwaway database of the self-hosted target, which is rebuilt for every CI run.
 */
test.use({ adminSession: 'storage-state' });

/** Unique per test and per repeat, so parallel workers and retries never find each other's data. */
const unique = () => randomUUID().slice(0, 8);

test.describe('Back office, real backend', { tag: ['@admin'] }, () => {
  // No word under three letters in this name: search requires every word, and MariaDB's full-text
  // index ignores short ones (BUG-28, pinned below).
  test('a product created in the back office is sold in the shop, repriced, then deleted', { tag: ['@flow'] }, async ({ adminProducts, shop, apiMock, createdProducts }) => {
    const name = `QaLab Product ${unique()}`;
    const form = await adminProducts.add();
    await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '3', price: '12.34' });
    const created = apiMock.waitForResponse<{ id: string }>('POST', '/products');
    await form.chrome.save();
    const { id } = (await created).json;
    createdProducts.track(id);
    await expect(form.chrome.alert('Product saved!')).toBeVisible();

    await shop.home.open();
    await shop.home.search.searchFor(name);
    await expect(shop.home.grid.card(name).price).toHaveText('$12.34');

    await adminProducts.open();
    await adminProducts.search.searchFor(name);
    const edit = await adminProducts.edit(name);
    // Wait for the form to load the product, or the load overwrites what is typed.
    await expect(edit.name).toHaveValue(name);
    // The edit form loads neither the stock (ADM-05) nor brand, category and image (ADM-09);
    // choosing waits for their options to arrive.
    await edit.stock.fill('3');
    await edit.chooseRelations();
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
    createdProducts.forget(id);
    await shop.home.open();
    await shop.home.search.searchFor(name);
    await expect(shop.home.grid.emptyState).toBeVisible();
  });

  test('a product with a short word in its name is found by its full name', { tag: ['@bug'] }, async ({ adminProducts, shop, apiMock, createdProducts }) => {
    knownBug('BUG-28', 'searching a product by its full name finds nothing when the name has a word under 3 letters ("of"): every word is required, but the full-text index drops short words.');
    const name = `Set of QaLab Pliers ${unique()}`;
    const form = await adminProducts.add();
    await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '1', price: '5.00' });
    const created = apiMock.waitForResponse<{ id: string }>('POST', '/products');
    await form.chrome.save();
    createdProducts.track((await created).json.id);
    await expect(form.chrome.alert('Product saved!')).toBeVisible();

    await shop.home.open();
    await shop.home.search.searchFor(name);

    await expect(shop.home.grid.card(name).root, 'BUG-28: a full-name search finds the product').toBeVisible({ timeout: 5_000 });
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

  test('a contact message arrives in the inbox and can be taken in progress', async ({ api, adminMessages, apiMock }) => {
    const sender = `Qa Lab Sender ${unique()}`;
    const text = `Sent by the qa-lab suite at ${new Date().toISOString()}, long enough to be a real message.`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('contact'), subject: 'webmaster', message: text });

    await adminMessages.open();
    const message = await adminMessages.details(sender);
    await expect(message.text(text)).toBeVisible();
    // The status is saved on change, with no confirmation on screen: wait for the PUT before reloading.
    const saved = apiMock.waitForResponse('PUT', /^\/messages\/[^/]+\/status$/);
    await message.setStatus('IN_PROGRESS');
    expect((await saved).response.ok(), 'the status change was saved').toBe(true);

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
