import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@fixtures';
import { ProfilePage } from '@pages/account/ProfilePage';
import { ATTRIBUTE_XSS_PAYLOAD, XSS_PAYLOADS } from '@fixtures/security';
import { API_URL } from '@support/env';
import { CONTACT_MESSAGE, fakeCustomer, fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Stored input: payloads are saved through a form and then shown to someone else, the admin or
 * the user themselves. These submit attack strings, so they only ever run against the
 * self-hosted Toolshop, our own environment, never the public site (@self-hosted).
 *
 * Cleanup: the brand and the product are deleted again through the admin API after every test (fixtures `brandNames` and
 * `productIds`), pass or fail, and a failed cleanup fails the test. Two kinds of record are deliberately left behind,
 * all uniquely named and harmless on the throwaway database of the self-hosted target, which is rebuilt for
 * every CI run (the same trade-off as tests/admin-e2e):
 * - one contact message per contact test: the API cannot delete a message (DELETE /messages/{id} answers 405);
 * - the customer registered by the last test: it carries the payload in its name by design, and the suite has no
 *   admin client call that deletes a user. It cannot collide with anything, its e-mail is unique per run.
 */
const payload = XSS_PAYLOADS['img onerror'];
const breakout = XSS_PAYLOADS['svg onload, breaking out of an attribute'];

const scriptTag = XSS_PAYLOADS['script tag'];

/**
 * A key no other test, worker, retry or earlier run shares, short enough for the API's field limits (a first name is capped
 * at 40 characters, and the payload already uses most of them). A random one, because the records these tests leave behind
 * (messages cannot be deleted) must never collide, whatever starts when.
 */
const uniqueKey = () => randomUUID().slice(0, 8);

/**
 * What a test saved in the shared database is removed again by the admin API, whether an assertion failed or not, and even
 * when the save went out but its answer never arrived: a brand is found by the name the test declared before saving, a
 * product by the id the test arranged. A cleanup that fails fails the test, so a leak is never silent.
 */
const test = base.extend<{ brandNames: Set<string>; productIds: Set<string> }>({
  brandNames: async ({ request, adminToken }, use) => {
    const names = new Set<string>();
    await use(names);
    if (!names.size) return;
    const authorization = `Bearer ${await adminToken()}`;
    const brands = (await (await request.get(`${API_URL}/brands`)).json()) as { id: string; name: string }[];
    const failures: unknown[] = [];
    for (const { id, name } of brands.filter((brand) => names.has(brand.name))) {
      const response = await request.delete(`${API_URL}/brands/${id}`, { headers: { authorization } });
      if (!response.ok()) failures.push(new Error(`Could not remove the brand "${name}": DELETE answered ${response.status()}`));
    }
    if (failures.length) throw new AggregateError(failures, 'Cleaning up the brands this test saved failed');
  },
  productIds: async ({ api, adminToken }, use) => {
    const ids = new Set<string>();
    await use(ids);
    const failures: unknown[] = [];
    for (const id of ids) {
      try {
        await api.deleteProduct(await adminToken(), id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Cleaning up the products this test made failed');
  },
});

test.describe('Injection, stored (self-hosted only)', { tag: ['@security', '@admin', '@self-hosted'] }, () => {
  test.use({ adminSession: 'storage-state', xssWatch: true });

  test('a contact message is shown to the admin as text', async ({ api, adminMessages, xss }) => {
    const sender = `Qa Lab ${payload} ${uniqueKey()}`;
    const message = `${CONTACT_MESSAGE} ${scriptTag} ${breakout}`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('xss'), subject: 'webmaster', message });

    await adminMessages.open();
    await expect(adminMessages.table.row(sender)).toBeVisible();
    // The list shows the sender's name: a sink of its own, before the details are opened.
    await xss.expectNoInjectedElements();
    const details = await adminMessages.details(sender);

    await expect(details.text(message)).toBeVisible();
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });

  test('a message sent through the contact form is shown to the admin as text', async ({ visitorContactPage, adminMessages, xss }) => {
    const from = { ...fakeGuest(), firstName: `Qa${breakout}`, lastName: `Xss${uniqueKey()}` };
    const message = `${CONTACT_MESSAGE} ${scriptTag}`;
    // The visitor is somebody else: their own browser context, not the admin's signed-in one.
    await visitorContactPage.send({ from, subject: 'Webmaster', message });
    await expect(visitorContactPage.successMessage).toBeVisible();

    await adminMessages.open();
    const row = adminMessages.table.row(from.lastName);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${from.firstName} ${from.lastName}`);
    await xss.expectNoInjectedElements();
    const details = await adminMessages.details(from.lastName);

    await expect(details.text(message)).toBeVisible();
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });

  test('a brand name is shown as text where the admin and the storefront list it', async ({ adminBrands, adminProducts, homePage, brandNames, xss }) => {
    const name = `Qa Lab ${payload} ${uniqueKey()}`;
    brandNames.add(name); // before the save, so the fixture removes it even if the save's answer never arrives
    // Both lists are fixtures here, so the page may be on either: start from the brands.
    await adminBrands.open();
    const form = await adminBrands.add();
    await form.fillIn({ name, slug: `qa-lab-xss-${uniqueKey()}` });
    await form.chrome.save();
    await expect(form.chrome.alert('Brand saved!')).toBeVisible();

    // 1. The admin's brand list.
    await adminBrands.open();
    await expect(adminBrands.table.row(name)).toBeVisible();
    await xss.expectNoInjectedElements();

    // 2. The brand options of the admin's product form: an option's label is a sink of its own.
    await adminProducts.open();
    const productForm = await adminProducts.add();
    await expect(productForm.brand.getByRole('option', { name, exact: true })).toHaveCount(1);
    await xss.expectNoInjectedElements();

    // 3. The storefront's filter sidebar, which any visitor sees: the same brand, listed for shoppers.
    await homePage.open();
    await expect(homePage.filters.brand(name)).toBeVisible();
    await xss.expectNoInjectedElements();

    await xss.expectNotExecuted();
  });

  // Attribute context: a product's name is also the `alt` of its picture, so a name that closes the quote would add an attribute
  // of its own. The product is the test's own (a rental, which the shop's default list does not show, so no catalogue spec sees it).
  test('a product name is shown as text, in the picture attribute that carries it too', async ({ request, catalog, adminToken, productIds, productPage, xss }) => {
    const template = await catalog.inStock();
    const name = `Qa Lab ${ATTRIBUTE_XSS_PAYLOAD} ${uniqueKey()}`;
    const created = await request.post(`${API_URL}/products`, {
      headers: { authorization: `Bearer ${await adminToken()}`, accept: 'application/json' },
      data: { name, description: 'Made by the stored-input checks.', price: 1.5, category_id: template.category.id, brand_id: template.brand.id, product_image_id: template.product_image.id, is_location_offer: false, is_rental: true },
    });
    expect(created.status(), 'the admin could create the product with this name').toBe(201);
    const { id } = (await created.json()) as { id: string };
    productIds.add(id);

    await productPage.open(id);

    await expect(productPage.name).toHaveText(name);
    // The picture is found by the whole name as its alt text: a quote that closed the attribute early would have cut it short.
    await expect(productPage.image(name)).toBeVisible();
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });
});

test.describe('Injection, stored by a customer (self-hosted only)', { tag: ['@security', '@account', '@self-hosted'] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, xssWatch: true });

  test('a name chosen at registration is shown in the header and on the profile as text', async ({ registerPage, xss }) => {
    // The API caps a first name at 40 characters; this payload stays under it.
    const customer = { ...fakeCustomer(), firstName: `Qa${breakout}` };

    const loginPage = await registerPage.register(customer);
    const account = await loginPage.login(customer.email, customer.password);

    await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${customer.lastName}`);
    await xss.expectNoInjectedElements();

    // The same name is the value of an input on the profile page: a sink of a different kind. The page object is built on
    // this page, not taken as a fixture: the fixture signs the seeded customer in first, and this test is the one who registers.
    const profilePage = new ProfilePage(registerPage.page);
    await profilePage.open();
    await expect(profilePage.firstName.input).toHaveValue(customer.firstName);
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });
});
