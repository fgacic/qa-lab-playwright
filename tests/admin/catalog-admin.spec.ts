import { expect, mock, test, withMocks } from '@fixtures';
import { brand, category } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

const newProduct = { name: 'Qa Lab Mock Product', description: 'Created against a mocked back office.', stock: '5', price: '9.99', co2Rating: 'B - Low environmental impact' };

test.describe('Admin products (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows the catalogue with stock and price', async ({ adminProducts, backOffice }) => {
    const row = adminProducts.table.row(backOffice.product.id);

    await expect(row).toContainText(backOffice.product.name);
    await expect(row).toContainText(`$${backOffice.product.price.toFixed(2)}`);
  });

  test('searching sends the term and lists the matches', async ({ adminProducts, apiMock }) => {
    const sent = apiMock.waitForRequest('QUERY', '/products/search');

    await adminProducts.search.searchFor('pliers');

    expect((await sent).postDataJSON()).toEqual({ q: 'pliers' });
    await expect(adminProducts.table.rows).toHaveCount(1);
  });

  test('Delete removes the product and confirms', async ({ adminProducts, backOffice, apiMock }) => {
    const deleted = apiMock.waitForRequest('DELETE', /^\/products\/[^/]+$/);

    await adminProducts.table.delete(backOffice.product.id);

    expect((await deleted).url()).toContain(backOffice.product.id);
    await expect(adminProducts.feedback.filter({ hasText: 'Product deleted.' })).toBeVisible();
  });

  test('Delete asks for confirmation first', { tag: ['@bug'] }, async ({ adminProducts, backOffice, page }) => {
    knownBug('ADM-02', 'Delete (products, brands, categories, users) acts on the first click, with no confirmation.');
    let asked = false;
    page.on('dialog', async (dialog) => { asked = true; await dialog.dismiss(); });

    await adminProducts.table.delete(backOffice.product.id);
    await expect(adminProducts.feedback.filter({ hasText: /deleted/ })).toBeVisible();

    expect(asked, 'a confirmation dialog').toBe(true);
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
      const sent = apiMock.waitForRequest('POST', '/products');

      await form.fillIn({ ...newProduct, price });
      await form.chrome.save();

      expect((await sent).postDataJSON()).toMatchObject({ price });
      await expect(form.chrome.alert(/price/i)).toBeVisible({ timeout: 2_000 });
    });
  }

  test('a saved product shows no leftover validation message', { tag: ['@bug'] }, async ({ adminProducts }) => {
    knownBug('ADM-04', '"Quantity is required" stays on screen next to "Product saved!" although Stock is filled in.');
    const form = await adminProducts.add();

    await form.fillIn(newProduct);
    await form.chrome.save();
    await expect(form.chrome.alert('Product saved!')).toBeVisible();

    await expect(form.chrome.alert('Quantity is required')).toBeHidden({ timeout: 2_000 });
  });

  test('editing loads the product and its specifications', async ({ adminProducts, backOffice }) => {
    const form = await adminProducts.edit(backOffice.product.id);

    await expect(form.chrome.heading).toHaveText('Edit Product');
    await expect(form.chrome.id).toHaveValue(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expect(form.price).toHaveValue(String(backOffice.product.price));
    await expect(form.specRows.filter({ hasText: 'Weight' })).toContainText('340');
  });

  test('an edited product can be saved without retyping its stock', { tag: ['@bug'] }, async ({ adminProducts, backOffice, apiMock }) => {
    knownBug('ADM-05', 'the edit form does not load the stock, so saving an existing product is blocked by "Quantity is required".');
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    const saved = apiMock.waitForRequest('PUT', /^\/products\/[^/]+$/);

    await form.price.fill('19.99');
    await form.chrome.save();

    await saved;
  });

  test('specifications are added and removed on the spot', async ({ adminProducts, backOffice, apiMock }) => {
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.specRows).toHaveCount(1);
    const added = apiMock.waitForRequest('POST', /^\/products\/[^/]+\/specs$/);

    await form.addSpec('Length', '200', 'mm');
    expect((await added).postDataJSON()).toEqual({ spec_name: 'Length', spec_value: '200', spec_unit: 'mm' });

    const removed = apiMock.waitForRequest('DELETE', /^\/products\/[^/]+\/specs\/[^/]+$/);
    await form.removeSpec('Weight');
    await removed;
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

  test('searching sends the term', async ({ adminBrands, apiMock }) => {
    const sent = apiMock.waitForRequest('QUERY', '/brands/search');

    await adminBrands.search.searchFor('qa');

    expect((await sent).postDataJSON()).toEqual({ q: 'qa' });
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
    const deleted = apiMock.waitForRequest('DELETE', `/brands/${brand.id}`);

    await adminBrands.table.delete(brand.name);

    await deleted;
    await expect(adminBrands.feedback.filter({ hasText: 'Brand deleted.' })).toBeVisible();
  });

  test.describe('when a brand is still in use', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('DELETE', /^\/brands\/[^/]+$/, 409, { message: 'Seems like this brand is used elsewhere.' })));

    test('the reason is shown and the brand stays', async ({ adminBrands }) => {
      await adminBrands.table.delete(brand.name);

      await expect(adminBrands.feedback.filter({ hasText: 'used elsewhere' })).toBeVisible();
      await expect(adminBrands.table.row(brand.name)).toBeVisible();
    });
  });
});

test.describe('Admin categories (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each category with its slug', async ({ adminCategories }) => {
    await expect(adminCategories.table.row(category.name)).toContainText(category.slug);
  });

  test('searching sends the term', async ({ adminCategories, apiMock }) => {
    const sent = apiMock.waitForRequest('QUERY', '/categories/search');

    await adminCategories.search.searchFor('qa');

    expect((await sent).postDataJSON()).toEqual({ q: 'qa' });
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
    const deleted = apiMock.waitForRequest('DELETE', `/categories/${category.id}`);

    await adminCategories.table.delete(category.name);

    await deleted;
    await expect(adminCategories.feedback.filter({ hasText: 'Category deleted.' })).toBeVisible();
  });
});
