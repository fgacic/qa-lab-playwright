import { expect, mock, test, withMocks } from '@fixtures';
import type { AdminProductForm } from '@pages/admin/AdminForms';
import type { AdminListPage } from '@pages/admin/AdminListPage';
import { ADM_14, ADMIN_MESSAGES, withLoggedFailure } from '@pages/admin/alerts';
import { REFUSED_STATUSES, brand, category, product, spec } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

const newProduct = { name: 'Qa Lab Mock Product', description: 'Created against a mocked back office.', stock: '5', price: '9.99', co2Rating: 'B - Low environmental impact' };

/** What an edit changes (the price) and fills in because the edit form does not load it (the stock: ADM-05). */
const EDITED = { price: '19.99', stock: '7' };

/** One product, by id. */
const PRODUCT = /^\/products\/[^/]+$/;

/** Opens the Add Product form and waits for it to be drawn, so that what a test fills in is not lost to a form that is still being built. */
async function openAddForm(products: AdminListPage<AdminProductForm>): Promise<AdminProductForm> {
  const form = await products.add();
  await expect(form.chrome.heading).toHaveText('Add Product');
  return form;
}

test.describe('Admin product form (mocked back office)', { tag: ['@mocked'] }, () => {
  test('a new product is saved with what was entered', async ({ adminProducts, apiMock }) => {
    const form = await openAddForm(adminProducts);
    const created = apiMock.waitForRequest('POST', '/products');

    await form.fillIn(newProduct);
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({
      name: newProduct.name, description: newProduct.description, price: newProduct.price, stock: newProduct.stock, co2_rating: 'B', brand_id: brand.id, category_id: category.id, product_image_id: product.product_image.id,
      is_rental: false, is_location_offer: false,
    });
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
  });

  // The two ticks are sent as booleans. Ticking "Item for rent" also clears Stock (a rental has none), so no stock is entered here.
  test('the rental and location-offer ticks are sent with the product', async ({ adminProducts, apiMock }) => {
    const form = await openAddForm(adminProducts);
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
      const form = await openAddForm(adminProducts);
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
      const form = await openAddForm(adminProducts);

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
    await expect(form.specRows.filter({ hasText: spec.spec_name })).toContainText(spec.spec_value);
  });

  test('an edited product is saved with the change', async ({ adminProducts, backOffice, apiMock }) => {
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    // The edit form loads neither the stock (ADM-05) nor brand, category and image (ADM-09): they are filled in here,
    // so that this proves the save itself and keeps passing, whichever of those two defects is fixed first.
    await form.stock.fill(EDITED.stock);
    await form.chooseRelations();
    const saved = apiMock.waitForRequest('PUT', PRODUCT);

    await form.price.fill(EDITED.price);
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ id: backOffice.product.id, name: backOffice.product.name, description: backOffice.product.description, price: EDITED.price, stock: EDITED.stock, brand_id: brand.id, category_id: category.id, product_image_id: backOffice.product.product_image.id });
    await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeVisible();
    await expect(form.chrome.alert(ADMIN_MESSAGES.quantityRequired)).toBeHidden();
  });

  test('an edited product can be saved without retyping its stock', { tag: ['@bug'] }, async ({ adminProducts, backOffice }) => {
    knownBug('ADM-05', 'the edit form does not load the stock, so saving an existing product is blocked by "Quantity is required".');
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    // Brand, category and image are empty too (ADM-09, pinned below); choose them so only the stock can block the save.
    await form.chooseRelations();

    await form.price.fill(EDITED.price);
    await form.chrome.save();

    // Either way the save is answered on screen: by the confirmation, or by the validation message that stopped it.
    // (.first(): with ADM-04 both may be on screen.)
    await expect(form.chrome.alert(new RegExp(`${ADMIN_MESSAGES.productSaved}|${ADMIN_MESSAGES.quantityRequired}`)).first()).toBeVisible();
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

  test.describe('when the product cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withLoggedFailure(mock.fail('GET', PRODUCT, 500)));

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

    test('a refused new product shows the API\'s reason and is not reported as saved', async ({ adminProducts }) => {
      const form = await adminProducts.add();

      await form.fillIn(newProduct);
      await form.chrome.save();

      await expect(form.chrome.alert(/already been taken|invalid/)).toBeVisible();
      await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeHidden();
    });
  });

  for (const status of REFUSED_STATUSES) {
    test.describe(`when saving an edited product is refused (${status})`, { tag: ['@negative'] }, () => {
      test.use(withLoggedFailure(mock.fail('PUT', PRODUCT, status, { message: 'The product could not be saved.' })));

      test('the failure is shown and nothing is reported as saved', async ({ adminProducts, backOffice, apiMock }) => {
        const form = await adminProducts.edit(backOffice.product.id);
        await expect(form.name).toHaveValue(backOffice.product.name);
        // Stock, brand, category and image are not loaded by the edit form (ADM-05, ADM-09): filled in, so that only the refusal can stop the save.
        await form.stock.fill(EDITED.stock);
        await form.chooseRelations();
        const refused = apiMock.waitForResponse('PUT', PRODUCT);

        await form.price.fill(EDITED.price);
        await form.chrome.save();
        expect((await refused).response.status(), 'the mocked refusal was sent').toBe(status);

        await expect(form.chrome.failure).toBeVisible();
        await expect(form.chrome.alert(ADMIN_MESSAGES.productSaved)).toBeHidden();
      });
    });
  }
});
