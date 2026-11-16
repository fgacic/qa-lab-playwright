import { expect, test } from '@fixtures';
import { alertAppears } from '@pages/admin/alerts';
import { brand, category, contactMessage, customer } from '@support/admin-payloads';

/**
 * The baseline of every "a failure is reported" pin on a form or a detail page (ADM-10, ADM-11, ADM-12, ADM-13, ADM-14, ADM-19):
 * `reportedFailure` (an alert, or the site's plain error text) must match nothing on the same pages when every request
 * succeeds. Without this, a locator that matched something always on screen would turn those pins green for the wrong reason.
 * (The lists, the dashboard and the statistics have their own baselines, in their specs.)
 */
test.describe('Admin forms and detail pages, healthy (mocked back office)', { tag: ['@mocked'] }, () => {
  test('a loaded product form shows no failure message', async ({ adminProducts, backOffice }) => {
    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expect(form.specRows).toHaveCount(1);

    expect(await alertAppears(form.chrome.failure), 'no failure message appears on a healthy product form').toBe(false);
  });

  test('a loaded brand form shows no failure message', async ({ adminBrands }) => {
    const form = await adminBrands.edit(brand.name);
    await expect(form.name.input).toHaveValue(brand.name);

    expect(await alertAppears(form.chrome.failure), 'no failure message appears on a healthy brand form').toBe(false);
  });

  test('a loaded category form shows no failure message', async ({ adminCategories }) => {
    const form = await adminCategories.edit(category.name);
    await expect(form.name.input).toHaveValue(category.name);

    expect(await alertAppears(form.chrome.failure), 'no failure message appears on a healthy category form').toBe(false);
  });

  test('a loaded user form shows no failure message', async ({ adminUsers }) => {
    const form = await adminUsers.edit(customer.email);
    await expect(form.email).toHaveValue(customer.email);

    expect(await alertAppears(form.chrome.failure), 'no failure message appears on a healthy user form').toBe(false);
  });

  test('a loaded message shows no failure message', async ({ adminMessages }) => {
    const message = await adminMessages.details(contactMessage.name);
    await expect(message.text(contactMessage.message)).toBeVisible();

    expect(await alertAppears(message.failure), 'no failure message appears on a healthy message page').toBe(false);
  });

  test('a loaded order shows no failure message', async ({ adminOrders, backOffice }) => {
    const order = await adminOrders.edit(backOffice.order.invoice_number);
    await expect(order.invoiceNumber).toHaveValue(backOffice.order.invoice_number);

    expect(await alertAppears(order.failure), 'no failure message appears on a healthy order page').toBe(false);
  });
});
