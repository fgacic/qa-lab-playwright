import { expect, test as base } from '@fixtures';
import { ADMIN_MESSAGES } from '@pages/admin/alerts';
import { ProfilePage } from '@pages/account/ProfilePage';
import { ATTRIBUTE_XSS_PAYLOADS, XSS_PAYLOADS } from '@fixtures/security';
import { API_URL } from '@support/env';
import { CONTACT_SUBJECTS } from '@support/payloads';
import { escapeRegExp } from '@support/regexp';
import { CONTACT_MESSAGE, fakeCustomer, fakeGuest, uniqueEmail, uniqueKey } from '@support/test-data';

/**
 * Stored input: payloads are saved through a form and then shown to someone else, the admin or
 * the user themselves. These submit attack strings, so they only ever run against the
 * self-hosted Toolshop, our own environment, never the public site (@self-hosted).
 *
 * Cleanup: the brand, the product and the customer are deleted again through the admin API after every test (the shared
 * `cleanups` fixture, fed by `removeBrandLater`, `makeRental` and `removeCustomerLater`), pass or fail, and a failed cleanup fails the test. One kind of record is
 * deliberately left behind, uniquely named and harmless on the throwaway database of the self-hosted target, which is rebuilt
 * for every CI run (the same trade-off as tests/admin-e2e): a contact message per contact test, because the API cannot
 * delete a message (DELETE /messages/{id} answers 405).
 *
 * Reading the checks: `expectNoInjectedElements` is a snapshot, so it is only ever called after the element that carries the
 * payload is visible (the row, the option, the heading, the field's value): anchored on the page having drawn it, a "no parsed payload"
 * is read off a finished page and not an empty one. `expectNotExecuted` comes last: it is the one that waits.
 */
const payload = XSS_PAYLOADS['img onerror'];
const breakout = XSS_PAYLOADS['svg onload, breaking out of an attribute'];

const scriptTag = XSS_PAYLOADS['script tag'];

/** The shop's confirmation after a profile is saved: the one thing the profile test waits for before it reloads the page to read the stored values back. */
const PROFILE_SAVED = 'Your profile is successfully updated!';

/** The subject both contact tests send: the form picks it by its label, the API takes its slug (the same subject, named twice). */
const SUBJECT = CONTACT_SUBJECTS[1];
/** The stem of every record name these tests make (a sender, a brand, a rental): the payload and a unique key follow it, so a test finds its own record. */
const NAME_STEM = 'Qa Lab';
/** A last name of 13 characters, within the 20 the field takes: a bare image tag, which `injectedCount` recognises by its `src="x"`. */
const SHORT_LAST_NAME_PAYLOAD = 'Qa<img src=x>';

/**
 * What a test saved in the shared database is removed again by the admin API, whether an assertion failed or not, and even
 * when the save went out but its answer never arrived: a brand is found by the name the test declared before saving, a
 * product by the id the test arranged, a customer by the e-mail the test registered with. The removals are entries of the
 * shared `cleanups` fixture (fixtures/security.ts), which runs them last made first and fails the test if one fails, so a leak is
 * never silent.
 */
const test = base.extend<{
  removeBrandLater: (name: string) => void;
  removeCustomerLater: (email: string) => void;
  makeRental: (product: { name: string; description?: string }) => Promise<string>;
}>({
  removeBrandLater: async ({ request, api, adminToken, cleanups }, use) => {
    await use((name) =>
      cleanups.push(async () => {
        const token = await adminToken();
        const brands = (await (await request.get(`${API_URL}/brands`)).json()) as { id: string; name: string }[];
        await Promise.all(brands.filter((brand) => brand.name === name).map((brand) => api.deleteBrand(token, brand.id)));
      }),
    );
  },
  removeCustomerLater: async ({ api, adminToken, cleanups }, use) => {
    await use((email) =>
      cleanups.push(async () => {
        const token = await adminToken();
        // Found by e-mail: a registration whose answer never arrived has no id the test could have kept. None found means nothing was saved.
        const user = await api.findUserByEmail(token, email);
        if (user) await api.deleteUser(token, user.id);
      }),
    );
  },
  /**
   * Makes a rental of the test's own through the admin API, removed after the test, and returns its id. A rental, because
   * the shop's default list shows none, so no catalogue spec sees it while it exists.
   */
  makeRental: async ({ api, catalog, adminToken, cleanups }, use) => {
    await use(async ({ name, description = 'Made by the stored-input checks.' }) => {
      const template = await catalog.inStock();
      const { id } = await api.createProduct(await adminToken(), {
        name,
        description,
        price: 1.5,
        category_id: template.category.id,
        brand_id: template.brand.id,
        product_image_id: template.product_image.id,
        is_rental: true,
      });
      cleanups.push(async () => api.deleteProduct(await adminToken(), id));
      return id;
    });
  },
});

test.describe('Injection, stored (self-hosted only)', { tag: ['@security', '@admin', '@self-hosted'] }, () => {
  test.use({ adminSession: 'storage-state', xssWatch: true });

  test('a contact message is shown to the admin as text', async ({ api, adminMessages, xss }) => {
    const sender = `${NAME_STEM} ${payload} ${uniqueKey()}`;
    const message = `${CONTACT_MESSAGE} ${scriptTag} ${breakout}`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('xss'), subject: SUBJECT.slug, message });

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
    await visitorContactPage.send({ from, subject: SUBJECT.label, message });
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

  test('a brand name is shown as text where the admin and the storefront list it', async ({ adminBrands, adminProducts, visitorHomePage, removeBrandLater, xss }) => {
    const name = `${NAME_STEM} ${payload} ${uniqueKey()}`;
    removeBrandLater(name); // before the save, so the fixture removes it even if the save's answer never arrives
    // Both lists are fixtures here, so the page may be on either: start from the brands.
    await adminBrands.open();
    const form = await adminBrands.add();
    await form.fillIn({ name, slug: `qa-lab-xss-${uniqueKey()}` });
    await form.chrome.save();
    await expect(form.chrome.alert(ADMIN_MESSAGES.brandSaved)).toBeVisible();

    // 1. The admin's brand list.
    await adminBrands.open();
    await expect(adminBrands.table.row(name)).toBeVisible();
    await xss.expectNoInjectedElements();

    // 2. The brand options of the admin's product form: an option's label is a sink of its own.
    await adminProducts.open();
    const productForm = await adminProducts.add();
    await expect(productForm.brand.getByRole('option', { name, exact: true })).toHaveCount(1);
    await xss.expectNoInjectedElements();

    // 3. The storefront's filter sidebar, as a shopper sees it: a context of their own with nobody signed in, not the admin's.
    await visitorHomePage.open();
    await expect(visitorHomePage.filters.brand(name)).toBeVisible();
    await xss.expectNoInjectedElements(visitorHomePage.page);

    await xss.expectNotExecuted();
  });

  // Attribute context: a product's name is also the `alt` of its picture (on the product page and on the card in the storefront's list),
  // so a name that closes the quote would add an attribute of its own. The product is the test's own (see `makeRental`).
  for (const [kind, { payload: attributePayload }] of Object.entries(ATTRIBUTE_XSS_PAYLOADS)) {
    test(`a product name with ${kind} is shown as text, in the picture attribute that carries it too`, async ({ makeRental, productPage, rentalsPage, xss }) => {
      const name = `${NAME_STEM} ${attributePayload} ${uniqueKey()}`;
      const id = await makeRental({ name });

      await productPage.open(id);

      // The heading is the name, and the "ECO" badge the product carries (a new product has a CO2 rating): nothing else may follow the name.
      await expect(productPage.name).toHaveText(new RegExp(`^\\s*${escapeRegExp(name)}\\s*(?:ECO\\s*)?$`));
      // The picture is found by the whole name as its alt text: a quote that closed the attribute early would have cut it short.
      await expect(productPage.image(name)).toBeVisible();
      await xss.expectNoInjectedElements();

      // The storefront's rentals list is the second sink of the same name: the card's picture, whose alt is the name, whole. Found by
      // that alt text on the page, not through the grid: the grid's card locator expects the upper-case ids of the seeded rentals, and a
      // product made through the API has a lower-case one.
      await rentalsPage.open();
      await expect(rentalsPage.page.getByRole('img', { name, exact: true })).toHaveAttribute('alt', name);
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });
  }

  // The description is free text the shop prints on the product page, below the name, and again under the card on the rentals list:
  // sinks of a different kind from a name.
  for (const [kind, payload] of Object.entries(XSS_PAYLOADS)) {
    test(`a product description with ${kind} is shown as text`, async ({ makeRental, productPage, rentalsPage, xss }) => {
      const description = `Made by the stored-input checks. ${payload} ${uniqueKey()}`;
      const id = await makeRental({ name: `${NAME_STEM} description ${uniqueKey()}`, description });

      await productPage.open(id);

      await expect(productPage.description).toHaveText(description);
      await xss.expectNoInjectedElements();

      await rentalsPage.open();
      await expect(rentalsPage.page.getByText(description, { exact: true })).toBeVisible();
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });
  }
});

test.describe('Injection, stored by a customer (self-hosted only)', { tag: ['@security', '@account', '@self-hosted'] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, xssWatch: true });

  test('a name chosen at registration is shown in the header and on the profile as text', async ({ registerPage, removeCustomerLater, xss }) => {
    // The API caps a first name at 40 characters; this payload stays under it.
    const customer = { ...fakeCustomer(), firstName: `Qa${breakout}` };
    removeCustomerLater(customer.email); // before the registration, so the fixture removes the account even if its answer never arrives

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

  test('a last name and an address saved on the profile are shown as text, in the header and in the profile fields', async ({ api, loginPage, removeCustomerLater, xss }) => {
    const customer = fakeCustomer();
    removeCustomerLater(customer.email); // before the registration, so the fixture removes the account even if its answer never arrives
    await api.registerCustomer(customer);
    const account = await loginPage.login(customer.email, customer.password);
    await expect(account.header.userMenu, 'signed in before the profile is opened').toHaveText(`${customer.firstName} ${customer.lastName}`);
    const profilePage = new ProfilePage(loginPage.page);
    await profilePage.open();
    await expect(profilePage.firstName.input, 'the profile has loaded the account before it is edited').toHaveValue(customer.firstName);
    // A last name may have 20 characters, too few for a payload that calls the hook (the shortest is 29): this one is a bare image
    // tag, which `injectedCount` recognises by its `src="x"` all the same, so a parsed one is still seen. The street takes the full payload.
    const lastName = SHORT_LAST_NAME_PAYLOAD;
    const street = payload;

    await profilePage.lastName.input.fill(lastName);
    await profilePage.street.input.fill(street);
    await profilePage.update();
    await expect(profilePage.alert(PROFILE_SAVED)).toBeVisible();
    // Read back from the server: a fresh load of the page, not the form the payload was typed into.
    await profilePage.open();

    await expect(profilePage.lastName.input).toHaveValue(lastName);
    await expect(profilePage.street.input).toHaveValue(street);
    await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${lastName}`);
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });
});
