import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_14, ADMIN_MESSAGES, allowLoggedFailure } from '@pages/admin/alerts';
import { SEARCH_HIT, brand, category, paginated } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

const newProduct = { name: 'Qa Lab Mock Product', description: 'Created against a mocked back office.', stock: '5', price: '9.99', co2Rating: 'B - Low environmental impact' };

/** The product endpoints the specs wait on or mock: one product, and its specifications. */
const PRODUCT = /^\/products\/[^/]+$/;
const SPECS = /^\/products\/[^/]+\/specs$/;
const SPEC = /^\/products\/[^/]+\/specs\/[^/]+$/;

test.describe('Admin products (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each product with its stock status and price', async ({ adminProducts, backOffice }) => {
    const row = adminProducts.table.row(backOffice.product.id);

    await expect(row).toContainText(backOffice.product.name);
    // The Stock column shows the product's in-stock flag ("true" / "false"), not a count.
    await expect(row.getByRole('cell', { name: String(backOffice.product.in_stock), exact: true })).toBeVisible();
    await expect(row).toContainText(`$${backOffice.product.price.toFixed(2)}`);
  });

  test('searching sends the term and lists the matches', async ({ adminProducts, backOffice, apiMock }) => {
    const match = { ...backOffice.product, id: '01QALABSEARCHHIT0000000000', name: SEARCH_HIT };
    await apiMock.use(mock.respond('QUERY', '/products/search', paginated([match], 9)));
    const sent = apiMock.waitForRequest('QUERY', '/products/search');

    await adminProducts.search.searchFor('pliers');

    expect((await sent).postDataJSON()).toEqual({ q: 'pliers' });
    await expect(adminProducts.table.row(match.name)).toBeVisible();
    await expect(adminProducts.table.rows).toHaveCount(1);
  });

  test('Reset clears the search and lists the whole catalogue again', async ({ adminProducts, backOffice, apiMock }) => {
    await apiMock.use(mock.respond('QUERY', '/products/search', paginated([], 9)));
    await adminProducts.search.searchFor('no such product');
    await expect(adminProducts.table.rows).toHaveCount(0);

    await adminProducts.search.reset();

    await expect(adminProducts.search.query).toHaveValue('');
    await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();
  });

  test('Delete removes the product and confirms', async ({ adminProducts, backOffice, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the product.
    await apiMock.use(mock.respond('QUERY', '/products', paginated([], 9)));
    await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', PRODUCT);

    await adminProducts.table.delete(backOffice.product.id);

    expect((await deleted).url()).toContain(backOffice.product.id);
    await expect(adminProducts.alert(ADMIN_MESSAGES.productDeleted)).toBeVisible();
    await expect(adminProducts.table.row(backOffice.product.id)).toHaveCount(0);
  });

  test.describe('when a product is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', PRODUCT, 409, { message: 'Seems like this product is used elsewhere.' })));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the reason is shown and the product stays', async ({ adminProducts, backOffice, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('QUERY', '/products', paginated([], 9)));
      await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();

      await adminProducts.table.delete(backOffice.product.id);

      await expect(adminProducts.alert('used elsewhere')).toBeVisible();
      await expect(adminProducts.alert(ADMIN_MESSAGES.productDeleted)).toBeHidden();
      await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();
    });
  });

  test.describe('when deleting a product fails on the server', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', PRODUCT, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the failure is shown and the product stays', async ({ adminProducts, backOffice, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('QUERY', '/products', paginated([], 9)));
      await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();

      await adminProducts.table.delete(backOffice.product.id);

      await expect(adminProducts.failure).toBeVisible();
      await expect(adminProducts.alert(ADMIN_MESSAGES.productDeleted)).toBeHidden();
      await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();
    });
  });

  test('a new product is saved with what was entered', async ({ adminProducts, apiMock }) => {
    const form = await adminProducts.add();
    await expect(form.chrome.heading).toHaveText('Add Product');
    const created = apiMock.waitForRequest('POST', '/products');

    await form.fillIn(newProduct);
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({
      name: newProduct.name, description: newProduct.description, price: '9.99', stock: '5', co2_rating: 'B', brand_id: brand.id, category_id: category.id,
      is_rental: false, is_location_offer: false,
    });
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
  });

  // The two ticks are sent as booleans. Ticking "Item for rent" also clears Stock (a rental has none), so no stock is entered here.
  test('the rental and location-offer ticks are sent with the product', async ({ adminProducts, apiMock }) => {
    const form = await adminProducts.add();
    await expect(form.chrome.heading).toHaveText('Add Product');
    const created = apiMock.waitForRequest('POST', '/products');

    await form.fillIn({ ...newProduct, rental: true, locationOffer: true });
    await expect(form.stock, 'a rental has no stock to enter').toHaveValue('');
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ name: newProduct.name, is_rental: true, is_location_offer: true });
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
  });

  // The CO₂ rating is sent as its letter, whatever the option's longer label says.
  for (const [label, letter] of [['A - Most environmentally friendly', 'A'], ['E - High environmental impact', 'E']] as const) {
    test(`the CO₂ rating "${letter}" is sent as its letter`, async ({ adminProducts, apiMock }) => {
      const form = await adminProducts.add();
      await expect(form.chrome.heading).toHaveText('Add Product');
      const created = apiMock.waitForRequest('POST', '/products');

      await form.fillIn({ ...newProduct, co2Rating: label });
      await form.chrome.save();

      expect((await created).postDataJSON()).toMatchObject({ co2_rating: letter });
    });
  }

  test('saving an empty product names the required fields', { tag: ['@negative'] }, async ({ adminProducts }) => {
    const form = await adminProducts.add();

    await form.chrome.save();

    for (const field of ['Name', 'Description', 'Price']) {
      await expect(form.chrome.required(field), field).toBeVisible();
    }
  });

  for (const price of ['abc', '-5']) {
    test(`a price of "${price}" is rejected by the form`, { tag: ['@negative', '@bug'] }, async ({ adminProducts, apiMock }) => {
      knownBug('ADM-03', 'the product form sends any price (text, negative) to the API without validating it.', { absence: true });
      const form = await adminProducts.add();
      await expect(form.chrome.heading).toHaveText('Add Product');

      await form.fillIn({ ...newProduct, price });
      await form.chrome.save();

      await expect(form.chrome.alert(/price/i), 'ADM-03: the form names the invalid price').toBeVisible({ timeout: BUG_TIMEOUT });
      // `expectNoRequest` watches a short window and rejects on the first POST; the message keeps the pin's id on that failure too.
      await expect(apiMock.expectNoRequest('POST', '/products'), 'ADM-03: no request is sent with an invalid price').resolves.toBeUndefined();
    });
  }

  test('a saved product shows no leftover validation message', { tag: ['@bug'] }, async ({ adminProducts }) => {
    knownBug('ADM-04', '"Quantity is required" stays on screen next to "Product saved!" although Stock is filled in.');
    const form = await adminProducts.add();

    await form.fillIn(newProduct);
    await form.chrome.save();
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();

    await expect(form.chrome.alert(ADMIN_MESSAGES.quantityRequired), 'ADM-04: no leftover "Quantity is required"').toBeHidden({ timeout: BUG_TIMEOUT });
  });

  test('editing loads the product and its specifications', async ({ adminProducts, backOffice }) => {
    const form = await adminProducts.edit(backOffice.product.id);

    await expect(form.chrome.heading).toHaveText('Edit Product');
    await expect(form.chrome.id).toHaveValue(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expect(form.price).toHaveValue(String(backOffice.product.price));
    await expect(form.specRows.filter({ hasText: 'Weight' })).toContainText('340');
  });

  test('an edited product is saved with the change', async ({ adminProducts, backOffice, apiMock }) => {
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    // The edit form loads neither the stock (ADM-05) nor brand, category and image (ADM-09): they are filled in here,
    // so that this proves the save itself and keeps passing, whichever of those two defects is fixed first.
    await form.stock.fill('7');
    await form.chooseRelations();
    const saved = apiMock.waitForRequest('PUT', PRODUCT);

    await form.price.fill('19.99');
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ id: backOffice.product.id, name: backOffice.product.name, description: backOffice.product.description, price: '19.99', stock: '7', brand_id: brand.id, category_id: category.id });
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
    await expect(form.chrome.alert(ADMIN_MESSAGES.quantityRequired)).toBeHidden();
  });

  test('an edited product can be saved without retyping its stock', { tag: ['@bug'] }, async ({ adminProducts, backOffice }) => {
    knownBug('ADM-05', 'the edit form does not load the stock, so saving an existing product is blocked by "Quantity is required".');
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    // Brand, category and image are empty too (ADM-09, pinned below); choose them so only the stock can block the save.
    await form.chooseRelations();

    await form.price.fill('19.99');
    await form.chrome.save();

    // Either way the save is answered on screen: a confirmation, or the validation messages that stopped it.
    await expect(form.chrome.alert(/saved!|is required/)).toBeVisible();
    await expect(form.chrome.alert(ADMIN_MESSAGES.quantityRequired), 'ADM-05: no "Quantity is required" after saving without retyping the stock').toBeHidden({ timeout: BUG_TIMEOUT });
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved), 'ADM-05: the product is saved without retyping its stock').toBeVisible();
  });

  test('editing preselects the product\'s brand and category', { tag: ['@bug'] }, async ({ adminProducts, backOffice }) => {
    knownBug('ADM-09', 'the edit form leaves Brand, Category and Image empty (the API sends brand/category/product_image objects, the form expects *_id fields), so saving is blocked until all three are chosen again.');
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    // The options are loaded: what is missing afterwards is the selection, not the list.
    await expect(form.brand.getByRole('option', { name: backOffice.product.brand.name })).toBeAttached();

    await expect(form.brand, 'ADM-09: the edit form preselects the product\'s brand').toHaveValue(backOffice.product.brand.id, { timeout: BUG_TIMEOUT });
  });

  test('specifications are added and removed on the spot', async ({ adminProducts, backOffice, apiMock }) => {
    // The API answers the new spec with values that differ from what was typed, so a row that shows them came from the answer.
    const stored = { id: '01QALABSPECLENGTH', product_id: backOffice.product.id, spec_name: 'Length (stored)', spec_value: '201', spec_unit: 'cm' };
    await apiMock.use(mock.respond('POST', SPECS, stored, 201));
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.specRows).toHaveCount(1);
    const added = apiMock.waitForRequest('POST', SPECS);

    await form.addSpec('Length', '200', 'mm');
    expect((await added).postDataJSON()).toEqual({ spec_name: 'Length', spec_value: '200', spec_unit: 'mm' });
    await expect(form.specRows).toHaveCount(2);
    await expect(form.specRows.filter({ hasText: stored.spec_name })).toContainText(`${stored.spec_value}${stored.spec_unit}`); // the cells' text runs together

    const removed = apiMock.waitForRequest('DELETE', SPEC);
    await form.removeSpec('Weight');
    await removed;
    await expect(form.specRows.filter({ hasText: 'Weight' })).toHaveCount(0);
    await expect(form.specRows.filter({ hasText: stored.spec_name })).toHaveCount(1);
  });

  test.describe('when a specification cannot be added', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', SPECS, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the failure is shown and no row is added', async ({ adminProducts, backOffice }) => {
      const form = await adminProducts.edit(backOffice.product.id);
      await expect(form.specRows).toHaveCount(1);

      await form.addSpec('Length', '200', 'mm');

      await expect(form.chrome.failure).toBeVisible();
      await expect(form.specRows).toHaveCount(1);
      await expect(form.specRows.filter({ hasText: 'Length' })).toHaveCount(0);
    });
  });

  test.describe('when a specification cannot be removed', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('DELETE', SPEC, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the specification stays', async ({ adminProducts, backOffice, apiMock }) => {
      knownBug('ADM-19', 'a specification the API refuses to remove (500) stays in the list and nothing says so.', { absence: true });
      const form = await adminProducts.edit(backOffice.product.id);
      await expect(form.specRows).toHaveCount(1);
      const refused = apiMock.waitForResponse('DELETE', SPEC);

      await form.removeSpec('Weight');
      await refused;

      // The row staying is right (the API kept it); what is missing is the word to the admin.
      await expect(form.specRows.filter({ hasText: 'Weight' })).toHaveCount(1);
      await expect(form.chrome.failure, 'ADM-19: a refused removal of a specification tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the product cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', PRODUCT, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the product could not be loaded', async ({ adminProducts, backOffice, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', PRODUCT);

      const form = await adminProducts.edit(backOffice.product.id);
      await failed;
      await expect(form.chrome.heading).toHaveText('Edit Product');

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(form.chrome.failure, 'ADM-14: a failed product load tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when saving is rejected', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/products', 422, { message: 'The given data was invalid.', errors: { name: ['The name has already been taken.'] } })));

    test('the API error is shown', async ({ adminProducts }) => {
      const form = await adminProducts.add();

      await form.fillIn(newProduct);
      await form.chrome.save();

      await expect(form.chrome.alert(/already been taken|invalid/)).toBeVisible();
      await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeHidden();
    });
  });
});
