import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '@fixtures';
import type { AdminProductForm } from '@pages/admin/AdminForms';
import type { AdminListPage } from '@pages/admin/AdminListPage';
import { ADMIN_MESSAGES, allowLoggedFailure } from '@pages/admin/alerts';
import type { HomePage } from '@pages/HomePage';
import { API_URL } from '@support/env';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeCustomer, fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Real back-office journeys against the real admin API, signed in from the `admin` project's
 * storageState (the seeded admin on the self-hosted Toolshop). They create, change and delete
 * data, so on the live site they only run with RUN_ADMIN_TESTS=1 and ADMIN_EMAIL / ADMIN_PASSWORD.
 * Every product a test creates carries a unique "QaLab" name and is a rental ("Item for rent"): the
 * shop's default list, categories, filters, sorting and pagination leave rentals out, so no catalogue spec
 * running at the same time (the `mobile` smoke set shares this project's pass) can see it or have its
 * totals shift. The shop's search still finds a rental, which is all these journeys need. (The rentals
 * page is the one list that shows it; no spec of the `admin` pass reads that page.) A test that creates
 * a product asks for `createdProducts`: it takes the id from the create response as it arrives and deletes
 * it in teardown, pass or fail, so even a test that times out waiting cannot leak one. The API cannot delete a guest order or a contact
 * message (DELETE /invoices/{id} and /messages/{id} answer 405), so those two tests leave one
 * uniquely named record each behind: they are tagged @self-hosted, never run on the live site,
 * and are harmless on the throwaway database of the self-hosted target, which is rebuilt for
 * every CI run. (Arranging them through the API is also refused on a shop that is not ours.)
 */
test.use({ adminSession: 'storage-state' });

/** Unique per test and per repeat, so parallel workers and retries never find each other's data. */
const unique = () => randomUUID().slice(0, 8);

const PRODUCT_DESCRIPTION = 'Created by the qa-lab suite; removed when the test ends.';

/** Creates a rental product through the back office's form and waits for the confirmation. */
async function createProduct(adminProducts: AdminListPage<AdminProductForm>, input: { name: string; stock: string; price: string }): Promise<void> {
  const form = await adminProducts.add();
  await form.fillIn({ ...input, description: PRODUCT_DESCRIPTION, rental: true });
  await form.chrome.save();
  await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
}

/** Finds the product in the back office's list by its name and sets a new price on its edit form. */
async function repriceProduct(adminProducts: AdminListPage<AdminProductForm>, name: string, price: string): Promise<void> {
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
  await edit.price.fill(price);
  await edit.chrome.save();
  await expect(edit.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
}

/** Removes a user the API accepted, if there is one: once ADM-20 is fixed the form creates it, and the shop's user list must not grow. */
async function removeUser(request: APIRequestContext, token: string, id: string | undefined): Promise<void> {
  if (!id) return;
  const response = await request.delete(`${API_URL}/users/${id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok()) throw new Error(`Could not remove the user ${id}: DELETE answered ${response.status()}`);
}

/** The shop's own search for a product name: the way a shopper would look for it. */
async function searchShopFor(home: HomePage, name: string): Promise<void> {
  await home.open();
  await home.search.searchFor(name);
}

test.describe('Back office, real backend', { tag: ['@admin'] }, () => {
  // No word under three letters in this name: search requires every word, and MariaDB's full-text
  // index ignores short ones (BUG-28, pinned below).
  test('a product created in the back office is listed in the shop, repriced, then deleted', { tag: ['@flow'] }, async ({ adminProducts, shop, createdProducts }) => {
    const name = `QaLab Product ${unique()}`;

    await test.step('Create the product in the back office', async () => {
      await createProduct(adminProducts, { name, stock: '3', price: '12.34' });
      await expect.poll(() => createdProducts.pending(), 'the created product is tracked for cleanup').toHaveLength(1);
    });

    await test.step('The shop lists it at the entered price', async () => {
      await searchShopFor(shop.home, name);
      await expect(shop.home.grid.card(name).price).toHaveText('$12.34');
    });

    await test.step('Reprice it in the back office', () => repriceProduct(adminProducts, name, '23.45'));

    await test.step('The shop shows the new price', async () => {
      await searchShopFor(shop.home, name);
      await expect(shop.home.grid.card(name).price).toHaveText('$23.45');
    });

    await test.step('Delete it in the back office; the shop no longer finds it', async () => {
      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      await adminProducts.table.delete(name);
      await expect(adminProducts.feedback.filter({ hasText: ADMIN_MESSAGES.productDeleted })).toBeVisible();
      await expect.poll(() => createdProducts.pending(), 'the UI delete really removed the product').toHaveLength(0);
      await searchShopFor(shop.home, name);
      await expect(shop.home.grid.emptyState).toBeVisible();
    });
  });

  test('a product with a short word in its name is found by its full name', { tag: ['@bug'] }, async ({ adminProducts, shop, createdProducts, apiMock }) => {
    knownBug('BUG-28', 'searching a product by its full name finds nothing when the name has a word under 3 letters ("of"): every word is required, but the full-text index drops short words.');
    const name = `Set of QaLab Pliers ${unique()}`;
    await createProduct(adminProducts, { name, stock: '1', price: '5.00' });
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

  test('a brand whose slug is taken is refused by the real API', { tag: ['@negative', '@bug'] }, async ({ adminBrands, brandFactory, apiMock, consoleGuard }) => {
    knownBug('ADM-12', 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.', { absence: true });
    allowLoggedFailure(consoleGuard); // the SPA logs the 409 it is about to say nothing about
    const taken = await brandFactory.create();
    const form = await adminBrands.add();
    const answered = apiMock.waitForResponse<{ slug?: string[] }>('POST', '/brands');

    await form.fillIn({ name: `${taken.name} again`, slug: taken.slug });
    await form.chrome.save();
    const { response, json } = await answered;

    // What the real backend says holds whether or not the form shows it: the refusal, with its reason, keyed by field.
    expect(response.status(), 'the real API refuses a second brand with the same slug').toBe(409);
    expect(json.slug?.[0], 'the reason the real API gives').toMatch(/already exists/);
    await expect(form.chrome.alert('already exists'), 'ADM-12: the form says why the brand was refused').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  // The API does accept this user when it is registered with the fields it names (probed on the self-hosted shop); what it refuses is what the form sends.
  test('a user added in the back office is created by the real API', { tag: ['@self-hosted', '@negative', '@bug'] }, async ({ adminUsers, apiMock, request, adminToken }) => {
    knownBug('ADM-20', 'the back office cannot create a user: the add form sends empty `enabled` and `failed_login_attempts` values, and the real API answers 500 "Something went wrong".');
    const customer = fakeCustomer();
    const form = await adminUsers.add();
    const answered = apiMock.waitForResponse<{ id?: string }>('POST', '/users/register');

    await form.fillIn({
      firstName: customer.firstName, lastName: customer.lastName, dateOfBirth: customer.dateOfBirth, email: customer.email, phone: customer.phone, password: customer.password,
      street: customer.address.street, city: customer.address.city, state: customer.address.state, postalCode: customer.address.postalCode, country: customer.address.country,
    });
    await form.chrome.save();
    const { response, json } = await answered;

    try {
      expect(response.status(), 'ADM-20: the real API accepts the user the add form sends').toBe(201);
      await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved), 'ADM-20: the form confirms the new user').toBeVisible({ timeout: BUG_TIMEOUT });
    } finally {
      await removeUser(request, await adminToken(), json?.id);
    }
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

  test('the real monthly sales answer has twelve months and the report draws its chart area', async ({ adminMonthlySales, apiMock }) => {
    // A <canvas> has nothing to read, so the data is checked on the answer that feeds it.
    const answered = apiMock.waitForResponse<unknown[]>('GET', '/reports/average-sales-per-month');
    await adminMonthlySales.open();
    const { json: months } = await answered;

    expect(months, 'one entry per month').toHaveLength(12);
    await expect(adminMonthlySales.heading).toBeVisible();
    await expect(adminMonthlySales.chart).toBeVisible();
  });
});
