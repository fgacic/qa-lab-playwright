import { expect, mock, test, withMocks } from '@fixtures';
import { allowLoggedFailure } from '@pages/admin/alerts';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** The specifications of one product, and one of them. */
const SPECS = /^\/products\/[^/]+\/specs$/;
const SPEC = /^\/products\/[^/]+\/specs\/[^/]+$/;

test.describe('Admin product specifications (mocked back office)', { tag: ['@mocked'] }, () => {
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
});
