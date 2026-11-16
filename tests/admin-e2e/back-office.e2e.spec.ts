import { randomUUID } from 'node:crypto';
import { expect, test } from '@fixtures';
import type { AdminProductForm } from '@pages/admin/AdminForms';
import type { AdminListPage } from '@pages/admin/AdminListPage';
import { ADM_12, ADMIN_MESSAGES, allowLoggedFailure } from '@pages/admin/alerts';
import type { HomePage } from '@pages/HomePage';
import { dollars } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeCustomer, fakeGuest, uniqueEmail } from '@support/test-data';
import { contactSubjectSlug } from '@support/payloads';

/**
 * Real back-office journeys against the real admin API, signed in from the `admin` project's
 * storageState (the seeded admin on the self-hosted Toolshop). They create, change and delete
 * data, so every test that writes is tagged @self-hosted and is never scheduled against the live site (config: `notOnThisTarget`);
 * on the live site, with RUN_ADMIN_TESTS=1 and ADMIN_EMAIL / ADMIN_PASSWORD, only the two read-only report tests at the end run.
 * Every product a test creates carries a unique "QaLab" name and is a rental ("Item for rent"): the
 * shop's default list, categories, filters, sorting and pagination leave rentals out, so no catalogue spec
 * running at the same time (the `mobile` smoke set shares this project's pass) can see it or have its
 * totals shift. The shop's search still finds a rental, which is all these journeys need. (The rentals
 * page is the one list that shows it; no spec of the `admin` pass reads that page.) A test that creates
 * a product asks for `createdProducts`: it takes the id from the create response as it arrives and deletes
 * it in teardown, pass or fail, so even a test that times out waiting cannot leak one. The API cannot delete a guest order or a contact
 * message (DELETE /invoices/{id} and /messages/{id} answer 405), so those two tests leave one
 * record each behind, named so that it can be told from anyone's data (`LEFTOVER`: the guest's last name, the sender's name).
 * They rely on the throwaway database of the
 * self-hosted target: CI builds and seeds it fresh for every job, and a local one is rebuilt with
 * `scripts/toolshop.sh reseed`. Nothing else in the suite counts orders or messages, so the leftovers cost no spec anything.
 * (Arranging them through the API is also refused on a shop that is not ours.) A user the form creates is removed by `createdUsers`.
 */
test.use({ adminSession: 'storage-state' });

/** Unique per test and per repeat, so parallel workers and retries never find each other's data. */
const unique = () => randomUUID().slice(0, 8);

/** What marks the records no API call can remove (a guest order, a contact message) as this suite's. */
const LEFTOVER = 'QaLab leftover';

/** The price the product is created with, then repriced to (what the form takes as typed; the shop shows it in dollars). */
const PRICE_ON_CREATE = '12.34';
const PRICE_AFTER_REPRICE = '23.45';

const PRODUCT_DESCRIPTION = 'Created by the qa-lab suite; removed when the test ends.';

/** Creates a rental product through the back office's form and waits for the confirmation. */
async function createProduct(adminProducts: AdminListPage<AdminProductForm>, input: { name: string; price: string }): Promise<void> {
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

/** The shop's own search for a product name: the way a shopper would look for it. */
async function searchShopFor(home: HomePage, name: string): Promise<void> {
  await home.open();
  await home.search.searchFor(name);
}

test.describe('Back office, real backend', { tag: ['@admin'] }, () => {
  // No word under three letters in this name: search requires every word, and MariaDB's full-text
  // index ignores short ones (BUG-28, pinned below).
  test('a product created in the back office is listed in the shop, repriced, then deleted', { tag: ['@self-hosted', '@flow'] }, async ({ adminProducts, shop, createdProducts }) => {
    const name = `QaLab Product ${unique()}`;

    await test.step('Create the product in the back office', async () => {
      await createProduct(adminProducts, { name, price: PRICE_ON_CREATE });
      await expect.poll(() => createdProducts.pending(), 'the created product is tracked for cleanup').toHaveLength(1);
    });

    await test.step('The shop lists it at the entered price', async () => {
      await searchShopFor(shop.home, name);
      await expect(shop.home.grid.card(name).price).toHaveText(dollars(Number(PRICE_ON_CREATE)));
    });

    await test.step('Reprice it in the back office', () => repriceProduct(adminProducts, name, PRICE_AFTER_REPRICE));

    await test.step('The shop shows the new price', async () => {
      await searchShopFor(shop.home, name);
      await expect(shop.home.grid.card(name).price).toHaveText(dollars(Number(PRICE_AFTER_REPRICE)));
    });

    await test.step('Delete it in the back office; the shop no longer finds it', async () => {
      await adminProducts.open();
      await adminProducts.search.searchFor(name);
      await adminProducts.table.delete(name);
      await expect(adminProducts.alert(ADMIN_MESSAGES.productDeleted)).toBeVisible();
      await expect.poll(() => createdProducts.pending(), 'the UI delete really removed the product').toHaveLength(0);
      await searchShopFor(shop.home, name);
      await expect(shop.home.grid.emptyState).toBeVisible();
    });
  });

  test('a product with a short word in its name is found by its full name', { tag: ['@self-hosted', '@bug'] }, async ({ adminProducts, shop, createdProducts, apiMock }) => {
    knownBug('BUG-28', 'searching a product by its full name finds nothing when the name has a word under 3 letters ("of"): every word is required, but the full-text index drops short words.');
    const name = `Set of QaLab Pliers ${unique()}`;
    await createProduct(adminProducts, { name, price: '5.00' });
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

  test('a brand whose slug is taken is refused by the real API', { tag: ['@self-hosted', '@negative', '@bug'] }, async ({ adminBrands, brandFactory, apiMock, consoleGuard }) => {
    knownBug('ADM-12', ADM_12, { absence: true });
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

  test('a brand is renamed in the back office and the real API lists the new name', { tag: ['@self-hosted'] }, async ({ adminBrands, brandFactory, api, apiMock }) => {
    const brand = await brandFactory.create();
    const renamed = `${brand.name} renamed`;
    await adminBrands.open();
    await adminBrands.search.searchFor(brand.name);
    const form = await adminBrands.edit(brand.name);
    await expect(form.name.input).toHaveValue(brand.name); // the load has finished: it would overwrite what is typed
    const saved = apiMock.waitForResponse('PUT', `/brands/${brand.id}`);

    await form.name.input.fill(renamed);
    await form.chrome.save();

    expect((await saved).response.ok(), 'the real API accepted the rename').toBe(true);
    await expect(form.chrome.alert(ADMIN_MESSAGES.brandSaved)).toBeVisible();
    await expect.poll(async () => (await api.listBrands()).find(({ id }) => id === brand.id)?.name, 'the real API lists the brand under its new name').toBe(renamed);
  });

  test('a brand deleted in the back office is gone from the real API', { tag: ['@self-hosted'] }, async ({ adminBrands, brandFactory, api, apiMock }) => {
    const brand = await brandFactory.create();
    await adminBrands.open();
    await adminBrands.search.searchFor(brand.name);
    await expect(adminBrands.table.row(brand.name)).toBeVisible();
    const deleted = apiMock.waitForResponse('DELETE', `/brands/${brand.id}`);

    await adminBrands.table.delete(brand.name);

    expect((await deleted).response.ok(), 'the real API accepted the delete').toBe(true);
    await expect(adminBrands.alert(ADMIN_MESSAGES.brandDeleted)).toBeVisible();
    await expect(adminBrands.table.row(brand.name)).toHaveCount(0);
    expect((await api.listBrands()).map(({ id }) => id), 'the real API no longer lists the brand').not.toContain(brand.id);
  });

  // The API does accept this user when it is registered with the fields it names (probed on the self-hosted shop); what it refuses is what the form sends.
  test('a user added in the back office is created by the real API', { tag: ['@self-hosted', '@negative', '@bug'] }, async ({ adminUsers, apiMock, createdUsers, consoleGuard }) => {
    knownBug('ADM-20', 'the back office cannot create a user: the add form sends empty `enabled` and `failed_login_attempts` values, and the real API answers 500 "Something went wrong".');
    consoleGuard.allow(/^Failed to load resource: the server responded with a status of 500/, 'ADM-20: the real API answers the add form with the 500 the pin is about');
    const customer = fakeCustomer();
    createdUsers.track(customer.email); // removed in teardown, whatever the form and the API do
    const form = await adminUsers.add();
    const answered = apiMock.waitForResponse('POST', '/users/register');

    await form.fillIn({
      firstName: customer.firstName, lastName: customer.lastName, dateOfBirth: customer.dateOfBirth, email: customer.email, phone: customer.phone, password: customer.password,
      street: customer.address.street, city: customer.address.city, state: customer.address.state, postalCode: customer.address.postalCode, country: customer.address.country,
    });
    await form.chrome.save();
    const { response, body } = await answered;

    // The documented cause, asserted as the behaviour a fixed form would show: the form sends a value for both account flags.
    expect.soft(body.enabled, 'ADM-20: the add form sends a value for `enabled`').not.toBe('');
    expect.soft(body.failed_login_attempts, 'ADM-20: the add form sends a value for `failed_login_attempts`').not.toBe('');
    expect(response.status(), `ADM-20: the real API accepts the user the add form sends (it answered ${response.status()})`).toBe(201);
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved), 'ADM-20: the form confirms the new user').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test('an order placed by a guest can be marked as shipped', { tag: ['@self-hosted'] }, async ({ api, catalog, adminOrders }) => {
    const { invoice_number } = await api.placeGuestOrder([{ product: await catalog.inStock(), quantity: 1 }], { ...fakeGuest(), lastName: `${LEFTOVER} ${unique()}` });

    await adminOrders.search.searchFor(invoice_number);
    const order = await adminOrders.edit(invoice_number);
    await order.updateStatus('SHIPPED');
    await expect(order.feedback.filter({ hasText: ADMIN_MESSAGES.statusUpdated })).toBeVisible();

    await order.page.reload();
    await expect(order.status).toHaveValue('SHIPPED');
  });

  test('a contact message arrives in the inbox, is taken in progress and is answered', { tag: ['@self-hosted'] }, async ({ api, adminMessages, apiMock, adminToken }) => {
    const sender = `${LEFTOVER} sender ${unique()}`;
    const text = `Sent by the qa-lab suite (${unique()}) and safe to delete, long enough to be a real message.`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('contact'), subject: contactSubjectSlug('Webmaster'), message: text });

    // The inbox lists newest first, 15 to a page, and has no search: the row is on page 1 unless 15 newer messages
    // arrive first. Reading page 1 from the API first makes that precondition explicit instead of a timeout on a row.
    const inbox = await api.listMessages(await adminToken());
    expect(inbox.map((m) => m.name), 'the new message is on the first page of the inbox').toContain(sender);
    await adminMessages.open();
    const message = await adminMessages.details(sender);
    await expect(message.text(text)).toBeVisible();
    // The status is saved on change, with no confirmation on screen: wait for the PUT before reloading.
    const saved = apiMock.waitForResponse('PUT', /^\/messages\/[^/]+\/status$/);
    await message.setStatus('IN_PROGRESS');
    expect((await saved).response.ok(), 'the status change was saved').toBe(true);

    await message.page.reload();
    await expect(message.status).toHaveValue('IN_PROGRESS');

    // The answer: the real API stores it and the page lists it under the message once it asks again.
    const answer = `Answered by the qa-lab suite (${unique()}).`;
    const replied = apiMock.waitForResponse('POST', /^\/messages\/[^/]+\/reply$/);
    await message.reply(answer);
    expect((await replied).response.ok(), 'the real API accepted the reply').toBe(true);
    await expect(message.text(answer), 'the reply is listed under the message').toBeVisible();
    await expect(message.replyBox).toHaveValue('');
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
