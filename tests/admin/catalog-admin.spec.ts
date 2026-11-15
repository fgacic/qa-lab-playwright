import { expect, mock, test, withMocks } from '@fixtures';
import { brand, category, customer, paginated } from '@support/admin-payloads';
import type { AdminListName } from '@pages/admin/admin-lists';
import { knownBug } from '@support/known-bug';

const newProduct = { name: 'Qa Lab Mock Product', description: 'Created against a mocked back office.', stock: '5', price: '9.99', co2Rating: 'B - Low environmental impact' };

test.describe('Admin products (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows the catalogue with stock and price', async ({ adminProducts, backOffice }) => {
    const row = adminProducts.table.row(backOffice.product.id);

    await expect(row).toContainText(backOffice.product.name);
    await expect(row).toContainText(`$${backOffice.product.price.toFixed(2)}`);
  });

  test('searching sends the term and lists the matches', async ({ adminProducts, backOffice, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { ...backOffice.product, id: '01QALABSEARCHHIT0000000000', name: 'Qa Lab Search Hit' };
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
    const deleted = apiMock.waitForRequest('DELETE', /^\/products\/[^/]+$/);

    await adminProducts.table.delete(backOffice.product.id);

    expect((await deleted).url()).toContain(backOffice.product.id);
    await expect(adminProducts.alert('Product deleted.')).toBeVisible();
    await expect(adminProducts.table.row(backOffice.product.id)).toHaveCount(0);
  });

  test.describe('when a product is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/products\/[^/]+$/, 409, { message: 'Seems like this product is used elsewhere.' })));

    test('the reason is shown and the product stays', async ({ adminProducts, backOffice, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('QUERY', '/products', paginated([], 9)));
      await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();

      await adminProducts.table.delete(backOffice.product.id);

      await expect(adminProducts.alert('used elsewhere')).toBeVisible();
      await expect(adminProducts.alert('Product deleted.')).toBeHidden();
      await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();
    });
  });

  test('a new product is saved with what was entered', async ({ adminProducts, apiMock }) => {
    const form = await adminProducts.add();
    await expect(form.chrome.heading).toHaveText('Add Product');
    const created = apiMock.waitForRequest('POST', '/products');

    await form.fillIn(newProduct);
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ name: newProduct.name, price: '9.99', stock: '5', co2_rating: 'B', brand_id: brand.id, category_id: category.id });
    await expect(form.chrome.alert('Product saved!')).toBeVisible();
  });

  test('saving an empty product names the required fields', { tag: ['@negative'] }, async ({ adminProducts }) => {
    const form = await adminProducts.add();

    await form.chrome.save();

    for (const message of ['Name is required', 'Description is required', 'Price is required']) {
      await expect(form.chrome.alert(message)).toBeVisible();
    }
  });

  for (const price of ['abc', '-5']) {
    test(`a price of "${price}" is rejected by the form`, { tag: ['@negative', '@bug'] }, async ({ adminProducts, apiMock }) => {
      knownBug('ADM-03', 'the product form sends any price (text, negative) to the API without validating it.');
      const form = await adminProducts.add();

      await form.fillIn({ ...newProduct, price });
      await form.chrome.save();

      await expect(form.chrome.alert(/price/i), 'ADM-03: the form names the invalid price').toBeVisible({ timeout: 2_000 });
      expect(apiMock.requestsTo('POST', '/products'), 'ADM-03: no request is sent with an invalid price').toBe(0);
    });
  }

  test('a saved product shows no leftover validation message', { tag: ['@bug'] }, async ({ adminProducts }) => {
    knownBug('ADM-04', '"Quantity is required" stays on screen next to "Product saved!" although Stock is filled in.');
    const form = await adminProducts.add();

    await form.fillIn(newProduct);
    await form.chrome.save();
    await expect(form.chrome.alert('Product saved!')).toBeVisible();

    await expect(form.chrome.alert('Quantity is required'), 'ADM-04: no leftover "Quantity is required"').toBeHidden({ timeout: 2_000 });
  });

  test('editing loads the product and its specifications', async ({ adminProducts, backOffice }) => {
    const form = await adminProducts.edit(backOffice.product.id);

    await expect(form.chrome.heading).toHaveText('Edit Product');
    await expect(form.chrome.id).toHaveValue(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expect(form.price).toHaveValue(String(backOffice.product.price));
    await expect(form.specRows.filter({ hasText: 'Weight' })).toContainText('340');
  });

  test('an edited product can be saved without retyping its stock', { tag: ['@bug'] }, async ({ adminProducts, backOffice }) => {
    knownBug('ADM-05', 'the edit form does not load the stock, so saving an existing product is blocked by "Quantity is required".');
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    // Brand, category and image are empty too (ADM-09, pinned below); choose them so only the stock can block the save.
    await form.chooseRelations();

    await form.price.fill('19.99');
    await form.chrome.save();

    await expect(form.chrome.alert('Product saved!'), 'ADM-05: the product is saved without retyping its stock').toBeVisible({ timeout: 2_000 });
  });

  test('editing preselects the product\'s brand and category', { tag: ['@bug'] }, async ({ adminProducts, backOffice }) => {
    knownBug('ADM-09', 'the edit form leaves Brand, Category and Image empty (the API sends brand/category/product_image objects, the form expects *_id fields), so saving is blocked until all three are chosen again.');
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);

    await expect(form.brand, 'ADM-09: the edit form preselects the product\'s brand').toHaveValue(backOffice.product.brand.id, { timeout: 2_000 });
  });

  test('specifications are added and removed on the spot', async ({ adminProducts, backOffice, apiMock }) => {
    // The new spec comes back from the API as it was sent.
    await apiMock.use(mock.respond('POST', /^\/products\/[^/]+\/specs$/, { id: '01QALABSPECLENGTH', product_id: backOffice.product.id, spec_name: 'Length', spec_value: '200', spec_unit: 'mm' }, 201));
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.specRows).toHaveCount(1);
    const added = apiMock.waitForRequest('POST', /^\/products\/[^/]+\/specs$/);

    await form.addSpec('Length', '200', 'mm');
    expect((await added).postDataJSON()).toEqual({ spec_name: 'Length', spec_value: '200', spec_unit: 'mm' });
    await expect(form.specRows).toHaveCount(2);

    const removed = apiMock.waitForRequest('DELETE', /^\/products\/[^/]+\/specs\/[^/]+$/);
    await form.removeSpec('Weight');
    await removed;
    await expect(form.specRows.filter({ hasText: 'Weight' })).toHaveCount(0);
    await expect(form.specRows.filter({ hasText: 'Length' })).toHaveCount(1);
  });

  test.describe('when saving is rejected', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/products', 422, { message: 'The given data was invalid.', errors: { name: ['The name has already been taken.'] } })));

    test('the API error is shown', async ({ adminProducts }) => {
      const form = await adminProducts.add();

      await form.fillIn(newProduct);
      await form.chrome.save();

      await expect(form.chrome.alert(/already been taken|invalid/)).toBeVisible();
      await expect(form.chrome.alert('Product saved!')).toBeHidden();
    });
  });
});

test.describe('Admin brands (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each brand with its slug', async ({ adminBrands }) => {
    await expect(adminBrands.table.row(brand.name)).toContainText(brand.slug);
  });

  test('searching sends the term and lists the matches', async ({ adminBrands, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { id: '01QALABBRANDHIT0000000000', name: 'Qa Lab Search Hit', slug: 'qa-lab-search-hit' };
    await apiMock.use(mock.respond('QUERY', '/brands/search', [match]));
    const sent = apiMock.waitForRequest('QUERY', '/brands/search');

    await adminBrands.search.searchFor('hit');

    expect((await sent).postDataJSON()).toEqual({ q: 'hit' });
    await expect(adminBrands.table.row(match.name)).toContainText(match.slug);
    await expect(adminBrands.table.row(brand.name)).toHaveCount(0);
  });

  test('a new brand is saved', async ({ adminBrands, apiMock }) => {
    const form = await adminBrands.add();
    const created = apiMock.waitForRequest('POST', '/brands');

    await form.fillIn({ name: 'Qa Lab New Brand', slug: 'qa-lab-new-brand' });
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ name: 'Qa Lab New Brand', slug: 'qa-lab-new-brand' });
    await expect(form.chrome.alert('Brand saved!')).toBeVisible();
  });

  test('name and slug are required', { tag: ['@negative'] }, async ({ adminBrands }) => {
    const form = await adminBrands.add();

    await form.chrome.save();

    await expect(form.name.error).toHaveText('Name is required');
    await expect(form.slug.error).toHaveText('Slug is required');
  });

  test('editing loads the brand and saves the change', async ({ adminBrands, apiMock }) => {
    const form = await adminBrands.edit(brand.name);
    await expect(form.name.input).toHaveValue(brand.name);
    const saved = apiMock.waitForRequest('PUT', `/brands/${brand.id}`);

    await form.name.input.fill('Qa Lab Renamed');
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ id: brand.id, name: 'Qa Lab Renamed', slug: brand.slug });
    await expect(form.chrome.alert('Brand saved!')).toBeVisible();
  });

  test('Delete removes the brand', async ({ adminBrands, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the brand.
    await apiMock.use(mock.respond('GET', '/brands', []));
    await expect(adminBrands.table.row(brand.name)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/brands/${brand.id}`);

    await adminBrands.table.delete(brand.name);

    await deleted;
    await expect(adminBrands.alert('Brand deleted.')).toBeVisible();
    await expect(adminBrands.table.row(brand.name)).toHaveCount(0);
  });

  test.describe('when saving a brand is refused', { tag: ['@negative', '@bug'] }, () => {
    // The real API answers a taken slug with 409 and the reason keyed by field (POST /brands, probed on the self-hosted shop).
    test.use(withMocks(mock.fail('POST', '/brands', 409, { slug: ['A brand already exists with this slug.'] })));

    test('the reason is shown', async ({ adminBrands, apiMock }) => {
      knownBug('ADM-12', 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.');
      const form = await adminBrands.add();
      const sent = apiMock.waitForRequest('POST', '/brands');

      await form.fillIn({ name: 'Qa Lab New Brand', slug: brand.slug });
      await form.chrome.save();
      await sent;

      await expect(form.chrome.alert('already exists'), 'ADM-12: the form says why the brand was refused').toBeVisible({ timeout: 2_000 });
    });
  });

  test.describe('when a brand is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/brands\/[^/]+$/, 409, { message: 'Seems like this brand is used elsewhere.' })));

    test('the reason is shown and the brand stays', async ({ adminBrands, apiMock }) => {
      // Were the page to reload the list or drop the row after the failed delete, this empty list would show it.
      await apiMock.use(mock.respond('GET', '/brands', []));
      await expect(adminBrands.table.row(brand.name)).toBeVisible();

      await adminBrands.table.delete(brand.name);

      await expect(adminBrands.alert('used elsewhere')).toBeVisible();
      await expect(adminBrands.table.row(brand.name)).toBeVisible();
    });
  });
});

test.describe('Admin categories (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each category with its slug', async ({ adminCategories }) => {
    await expect(adminCategories.table.row(category.name)).toContainText(category.slug);
  });

  test('searching sends the term and lists the matches', async ({ adminCategories, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { ...category, id: '01QALABCATEGORYHIT00000000', name: 'Qa Lab Search Hit', slug: 'qa-lab-search-hit' };
    await apiMock.use(mock.respond('QUERY', '/categories/search', [match]));
    const sent = apiMock.waitForRequest('QUERY', '/categories/search');

    await adminCategories.search.searchFor('hit');

    expect((await sent).postDataJSON()).toEqual({ q: 'hit' });
    await expect(adminCategories.table.row(match.name)).toContainText(match.slug);
    await expect(adminCategories.table.row(category.name)).toHaveCount(0);
  });

  test('a new subcategory is saved under its parent', async ({ adminCategories, apiMock }) => {
    const form = await adminCategories.add();
    const created = apiMock.waitForRequest('POST', '/categories');

    await form.fillIn({ name: 'Qa Lab Sub', slug: 'qa-lab-sub', parent: category.name });
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ name: 'Qa Lab Sub', slug: 'qa-lab-sub', parent_id: category.id });
    await expect(form.chrome.alert('Category saved!')).toBeVisible();
  });

  test('name and slug are required', { tag: ['@negative'] }, async ({ adminCategories }) => {
    const form = await adminCategories.add();

    await form.chrome.save();

    await expect(form.chrome.alert('Name is required')).toBeVisible();
    await expect(form.chrome.alert('Slug is required')).toBeVisible();
  });

  test('editing loads the category and saves the change', async ({ adminCategories, apiMock }) => {
    const form = await adminCategories.edit(category.name);
    await expect(form.name).toHaveValue(category.name);
    const saved = apiMock.waitForRequest('PUT', `/categories/${category.id}`);

    await form.slug.fill('qa-lab-renamed');
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ name: category.name, slug: 'qa-lab-renamed' });
  });

  test('Delete removes the category', async ({ adminCategories, apiMock }) => {
    // Once deleted, the list the page reloads no longer has the category.
    await apiMock.use(mock.respond('GET', '/categories', []));
    await expect(adminCategories.table.row(category.name)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/categories/${category.id}`);

    await adminCategories.table.delete(category.name);

    await deleted;
    await expect(adminCategories.alert('Category deleted.')).toBeVisible();
    await expect(adminCategories.table.row(category.name)).toHaveCount(0);
  });

  test.describe('when saving a category is refused', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('POST', '/categories', 409, { slug: ['A category already exists with this slug.'] })));

    test('the reason is shown', async ({ adminCategories, apiMock }) => {
      knownBug('ADM-12', 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.');
      const form = await adminCategories.add();
      const sent = apiMock.waitForRequest('POST', '/categories');

      await form.fillIn({ name: 'Qa Lab New Category', slug: category.slug });
      await form.chrome.save();
      await sent;

      await expect(form.chrome.alert('already exists'), 'ADM-12: the form says why the category was refused').toBeVisible({ timeout: 2_000 });
    });
  });
});

/** The four lists whose Delete is one click. The row to delete is named by what the mocked list shows for it. */
const deletable: { name: AdminListName; rowText: (product: { id: string }) => string }[] = [
  { name: 'products', rowText: (product) => product.id },
  { name: 'brands', rowText: () => brand.name },
  { name: 'categories', rowText: () => category.name },
  { name: 'users', rowText: () => customer.email },
];

test.describe('Admin delete (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const { name, rowText } of deletable) {
    test.describe(name, { tag: ['@bug'] }, () => {
      test.use({ adminListName: name });

      test(`Delete asks for confirmation first (${name})`, async ({ adminList, backOffice, page }) => {
        knownBug('ADM-02', 'Delete (products, brands, categories, users) acts on the first click, with no confirmation.');
        let asked = false;
        page.on('dialog', async (dialog) => { asked = true; await dialog.dismiss(); });

        // A confirm() opens during the click and the click returns once the dialog is dismissed,
        // so `asked` is final here whether the site has the dialog or not.
        await adminList.table.delete(rowText(backOffice.product));

        expect(asked, `ADM-02: Delete asks for confirmation before it deletes a ${name} record`).toBe(true);
      });
    });
  }
});
