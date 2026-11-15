import { expect, test } from '@fixtures';
import type { AdminBrandForm } from '@pages/admin/AdminForms';
import type { AdminListPage } from '@pages/admin/AdminListPage';
import { XSS_PAYLOADS } from '@fixtures/security';
import { CONTACT_MESSAGE, fakeCustomer, fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Stored input: payloads are saved through a form and then shown to someone else, the admin or
 * the user themselves. These submit attack strings, so they only ever run against the
 * self-hosted Toolshop, our own environment, never the public site (@self-hosted).
 *
 * Cleanup: the brand is deleted again, pass or fail. Two kinds of record are deliberately left behind,
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
 * Removes the brand a test saved. The brand lives in the shared database, so it goes even when an assertion failed, and even when
 * the save went out but its answer never arrived: it is looked up by name, not by a flag. A cleanup that fails after the test
 * already failed is recorded as an annotation and never thrown, so it cannot replace the error that matters.
 */
async function removeBrand(adminBrands: AdminListPage<AdminBrandForm>, name: string, testPassed: boolean): Promise<void> {
  try {
    await adminBrands.open();
    await expect(adminBrands.table.rows.first()).toBeVisible();
    if ((await adminBrands.table.row(name).count()) > 0) {
      await adminBrands.table.delete(name);
      await expect(adminBrands.feedback.filter({ hasText: 'Brand deleted.' })).toBeVisible();
    }
  } catch (cleanupError) {
    if (testPassed) throw cleanupError;
    test.info().annotations.push({ type: 'cleanup failed', description: `brand "${name}" may be left behind: ${String(cleanupError).slice(0, 300)}` });
  }
}

test.describe('Injection, stored (self-hosted only)', { tag: ['@security', '@admin', '@self-hosted'] }, () => {
  test.use({ adminSession: 'storage-state', xssWatch: true });

  test('a contact message is shown to the admin as text', async ({ api, adminMessages, xss }) => {
    const sender = `Qa Lab ${payload} ${Date.now().toString(36)}`;
    const message = `${CONTACT_MESSAGE} ${scriptTag} ${breakout}`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('xss'), subject: 'webmaster', message });

    await adminMessages.open();
    await expect(adminMessages.table.row(sender)).toBeVisible();
    const details = await adminMessages.details(sender);

    await expect(details.text(message)).toBeVisible();
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });

  test('a message sent through the contact form is shown to the admin as text', async ({ visitorContactPage, adminMessages, xss }) => {
    const from = { ...fakeGuest(), firstName: `Qa${breakout}`, lastName: `Xss${Date.now().toString(36)}` };
    const message = `${CONTACT_MESSAGE} ${scriptTag}`;
    // The visitor is somebody else: their own browser context, not the admin's signed-in one.
    await visitorContactPage.send({ from, subject: 'Webmaster', message });
    await expect(visitorContactPage.successMessage).toBeVisible();

    await adminMessages.open();
    const row = adminMessages.table.row(from.lastName);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${from.firstName} ${from.lastName}`);
    const details = await adminMessages.details(from.lastName);

    await expect(details.text(message)).toBeVisible();
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });

  test('a brand name is listed as text', async ({ adminBrands, xss }) => {
    const name = `Qa Lab ${payload} ${Date.now().toString(36)}`;
    let passed = false;
    try {
      const form = await adminBrands.add();
      await form.fillIn({ name, slug: `qa-lab-xss-${Date.now().toString(36)}` });
      await form.chrome.save();
      await expect(form.chrome.alert('Brand saved!')).toBeVisible();

      await adminBrands.open();
      await expect(adminBrands.table.row(name)).toBeVisible();
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
      passed = true;
    } finally {
      await removeBrand(adminBrands, name, passed);
    }
  });
});

test.describe('Injection, stored by a customer (self-hosted only)', { tag: ['@security', '@account', '@self-hosted'] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, xssWatch: true });

  test('a name chosen at registration is shown in the header as text', async ({ registerPage, xss }) => {
    // The API caps a first name at 40 characters; this payload stays under it.
    const customer = { ...fakeCustomer(), firstName: `Qa${breakout}` };

    const loginPage = await registerPage.register(customer);
    const account = await loginPage.login(customer.email, customer.password);

    await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${customer.lastName}`);
    await xss.expectNoInjectedElements();
    await xss.expectNotExecuted();
  });
});
