import { randomUUID } from 'node:crypto';
import { expect, test } from '@fixtures';
import { ADMIN_MESSAGES } from '@pages/admin/alerts';
import { API_URL } from '@support/env';
import { knownBug } from '@support/known-bug';
import { fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Real back-office journeys against the real admin API, signed in from the `admin` project's
 * storageState (the seeded admin on the self-hosted Toolshop). They create, change and delete
 * data, so on the live site they only run with RUN_ADMIN_TESTS=1 and ADMIN_EMAIL / ADMIN_PASSWORD.
 * Every product a test creates carries a unique "QaLab" name and is a rental ("Item for rent"): the
 * shop's default list, categories, filters, sorting and pagination leave rentals out, so no catalogue spec
 * running at the same time (the `mobile` smoke set shares this project's pass) can see it or have its
 * totals shift. The shop's search still finds a rental, which is all these journeys need. (The rentals
 * page is the one list that shows it; no spec of the `admin` pass reads that page.) `createdProducts`
 * is automatic here: it takes the id from the create response as it arrives and deletes it in
 * teardown, pass or fail, so even a test that times out waiting cannot leak one. The API cannot delete a guest order or a contact
 * message (DELETE /invoices/{id} and /messages/{id} answer 405), so those two tests leave one
 * uniquely named record each behind: they are tagged @self-hosted, never run on the live site,
 * and are harmless on the throwaway database of the self-hosted target, which is rebuilt for
 * every CI run. (Arranging them through the API is also refused on a shop that is not ours.)
 */
test.use({ adminSession: 'storage-state' });

/** Unique per test and per repeat, so parallel workers and retries never find each other's data. */
const unique = () => randomUUID().slice(0, 8);

test.describe('Back office, real backend', { tag: ['@admin'] }, () => {
  // No word under three letters in this name: search requires every word, and MariaDB's full-text
  // index ignores short ones (BUG-28, pinned below).
  test('a product created in the back office is listed in the shop, repriced, then deleted', { tag: ['@flow'] }, async ({ adminProducts, shop, createdProducts }) => {
    const name = `QaLab Product ${unique()}`;
    await test.step('Create the product in the back office', async () => {
      const form = await adminProducts.add();
      await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '3', price: '12.34', rental: true });
      await form.chrome.save();
      await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
      await expect.poll(() => createdProducts.pending(), 'the created product is tracked for cleanup').toHaveLength(1);
    });

    await test.step('The shop lists it at the entered price', async () => {
      await shop.home.open();
      await shop.home.search.searchFor(name);
      await expect(shop.home.grid.card(name).price).toHaveText('$12.34');
    });

    await test.step('Reprice it in the back office', async () => {
      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      const edit = await adminProducts.edit(name);
      // Wait for the form to load the product, or the load overwrites what is typed.
      await expect(edit.name).toHaveValue(name);
      // The edit form loads neither the stock (ADM-05) nor brand, category and image (ADM-09);
      // choosing waits for their options to arrive. It does load the rental flag, which keeps the product out of the catalogue.
      await expect(edit.rental).toBeChecked();
      await edit.stock.fill('3');
      await edit.chooseRelations();
      await edit.price.fill('23.45');
      await edit.chrome.save();
      await expect(edit.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
    });

    await test.step('The shop shows the new price', async () => {
      await shop.home.open();
      await shop.home.search.searchFor(name);
      await expect(shop.home.grid.card(name).price).toHaveText('$23.45');
    });

    await test.step('Delete it in the back office; the shop no longer finds it', async () => {
      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      await adminProducts.table.delete(name);
      await expect(adminProducts.feedback.filter({ hasText: ADMIN_MESSAGES.productDeleted })).toBeVisible();
      await expect.poll(() => createdProducts.pending(), 'the UI delete really removed the product').toHaveLength(0);
      await shop.home.open();
      await shop.home.search.searchFor(name);
      await expect(shop.home.grid.emptyState).toBeVisible();
    });
  });

  test('a product with a short word in its name is found by its full name', { tag: ['@bug'] }, async ({ adminProducts, shop, createdProducts, apiMock }) => {
    knownBug('BUG-28', 'searching a product by its full name finds nothing when the name has a word under 3 letters ("of"): every word is required, but the full-text index drops short words.');
    const name = `Set of QaLab Pliers ${unique()}`;
    const form = await adminProducts.add();
    await form.fillIn({ name, description: 'Created by the qa-lab suite; removed when the test ends.', stock: '1', price: '5.00', rental: true });
    await form.chrome.save();
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
    await expect.poll(() => createdProducts.pending(), 'the created product is tracked for cleanup').toHaveLength(1);

    await shop.home.open();
    const answered = apiMock.waitForResponse<{ data: { name: string }[] }>('QUERY', '/products/search');
    await shop.home.search.searchFor(name);
    const { response, json: found } = await answered;

    // The search was answered and the product exists (it was just saved): what is left to ask is whether the answer has it.
    expect(response.ok(), 'the search request succeeded').toBe(true);
    expect(found.data.map((product) => product.name), 'BUG-28: the search answer lists the product').toContain(name);
    await expect(shop.home.grid.card(name).root, 'BUG-28: a full-name search finds the product').toBeVisible();
  });

  test('a brand whose slug is taken is refused by the real API', { tag: ['@negative', '@bug'] }, async ({ adminBrands, brandFactory, apiMock }) => {
    knownBug('ADM-12', 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.', { absence: true });
    const taken = await brandFactory.create();
    const form = await adminBrands.add();
    const answered = apiMock.waitForResponse<{ slug?: string[] }>('POST', '/brands');

    await form.fillIn({ name: `${taken.name} again`, slug: taken.slug });
    await form.chrome.save();
    const { response, json } = await answered;

    // What the real backend says holds whether or not the form shows it: the refusal, with its reason, keyed by field.
    expect(response.status(), 'the real API refuses a second brand with the same slug').toBe(409);
    expect(json.slug?.[0], 'the reason the real API gives').toMatch(/already exists/);
    await expect(form.chrome.alert('already exists'), 'ADM-12: the form says why the brand was refused').toBeVisible({ timeout: 2_000 });
  });

  test('an order placed by a guest can be marked as shipped', { tag: ['@self-hosted'] }, async ({ api, catalog, adminOrders }) => {
    const { invoice_number } = await api.placeGuestOrder([{ product: await catalog.inStock(), quantity: 1 }], fakeGuest());

    await adminOrders.search.searchFor(invoice_number);
    const order = await adminOrders.edit(invoice_number);
    await order.updateStatus('SHIPPED');
    await expect(order.feedback.filter({ hasText: ADMIN_MESSAGES.statusUpdated })).toBeVisible();

    await order.page.reload();
    await expect(order.status).toHaveValue('SHIPPED');
  });

  test('a contact message arrives in the inbox and can be taken in progress', { tag: ['@self-hosted'] }, async ({ api, adminMessages, apiMock, request, adminToken }) => {
    const sender = `Qa Lab Sender ${unique()}`;
    const text = `Sent by the qa-lab suite at ${new Date().toISOString()}, long enough to be a real message.`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('contact'), subject: 'webmaster', message: text });

    // The inbox lists newest first, 15 to a page, and has no search: the row is on page 1 unless 15 newer messages
    // arrive first. Reading page 1 from the API first makes that precondition explicit instead of a timeout on a row.
    const inbox = await request.get(`${API_URL}/messages`, { headers: { authorization: `Bearer ${await adminToken()}` } });
    expect((await inbox.json()).data.map((m: { name: string }) => m.name), 'the new message is on the first page of the inbox').toContain(sender);
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

  test('the statistics list the real top-selling products', async ({ adminStatistics, apiMock }) => {
    // The fixture opened the page already; open it again to catch the answer for this check.
    const answered = apiMock.waitForResponse<{ name: string; count: number }[]>('GET', '/reports/top10-purchased-products');
    await adminStatistics.open();
    const { json: purchased } = await answered;

    expect(purchased.length, 'the seeded shop has sales to report').toBeGreaterThan(0);
    await expect(adminStatistics.heading).toBeVisible();
    await expect(adminStatistics.report('Top 10 Most Purchased Products')).toHaveCount(purchased.length);
    await expect(adminStatistics.report('Top 10 Most Purchased Products').first()).toContainText(purchased[0].name);
  });

  test('the monthly sales report is fed twelve months and has a chart area', async ({ adminMonthlySales, apiMock }) => {
    // A <canvas> has nothing to read, so the data is checked on the answer that feeds it.
    const answered = apiMock.waitForResponse<unknown[]>('GET', '/reports/average-sales-per-month');
    await adminMonthlySales.open();
    const { json: months } = await answered;

    expect(months, 'one entry per month').toHaveLength(12);
    await expect(adminMonthlySales.heading).toBeVisible();
    await expect(adminMonthlySales.chart).toBeVisible();
  });
});
