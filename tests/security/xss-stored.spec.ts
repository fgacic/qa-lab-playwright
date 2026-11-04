import { expect, test } from '@fixtures';
import { XSS_PAYLOADS } from '../../fixtures/security';
import { CONTACT_MESSAGE, fakeCustomer, fakeGuest, uniqueEmail } from '@support/test-data';

/**
 * Stored input: payloads are saved through a form and then shown to someone else, the admin or
 * the user themselves. These submit attack strings, so they only ever run against the
 * self-hosted Toolshop, our own environment, never the public site (@self-hosted).
 */
const payload = XSS_PAYLOADS['img onerror'];
const breakout = XSS_PAYLOADS['svg onload, breaking out of an attribute'];

test.describe('Injection, stored (self-hosted only)', { tag: ['@security', '@admin', '@self-hosted'] }, () => {
  test.use({ adminSession: 'storage-state' });

  test('a contact message is shown to the admin as text', async ({ api, adminMessages, xss }) => {
    const sender = `Qa Lab ${payload} ${Date.now().toString(36)}`;
    await api.sendContactMessage({ name: sender, email: uniqueEmail('xss'), subject: 'webmaster', message: `${CONTACT_MESSAGE} ${breakout}` });

    await adminMessages.open();
    await expect(adminMessages.table.row(sender)).toBeVisible();
    const message = await adminMessages.details(sender);

    await expect(message.text(`${CONTACT_MESSAGE} ${breakout}`)).toBeVisible();
    await expect(xss.injectedElements()).toHaveCount(0);
    expect(await xss.executed(), 'the payload executed').toBe(false);
  });

  test('a brand name is listed as text', async ({ adminBrands, xss, page }) => {
    const name = `Qa Lab ${payload} ${Date.now().toString(36)}`;
    const form = await adminBrands.add();
    await form.fillIn({ name, slug: `qa-lab-xss-${Date.now().toString(36)}` });
    await form.chrome.save();
    await expect(form.chrome.alert('Brand saved!')).toBeVisible();

    await adminBrands.open();
    await expect(adminBrands.table.row(name)).toBeVisible();
    await expect(xss.injectedElements()).toHaveCount(0);
    expect(await xss.executed(), 'the payload executed').toBe(false);

    await adminBrands.table.delete(name);
    await expect(page.getByRole('alert').filter({ hasText: 'Brand deleted.' })).toBeVisible();
  });
});

test.describe('Injection, stored by a customer (self-hosted only)', { tag: ['@security', '@account', '@self-hosted'] }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a name chosen at registration is shown in the header as text', async ({ registerPage, xss }) => {
    // The API caps a first name at 40 characters; this payload stays under it.
    const customer = { ...fakeCustomer(), firstName: `Qa${breakout}` };

    const loginPage = await registerPage.register(customer);
    const account = await loginPage.login(customer.email, customer.password);

    await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${customer.lastName}`);
    await expect(xss.injectedElements()).toHaveCount(0);
    expect(await xss.executed(), 'the payload executed').toBe(false);
  });

  test('a contact form submission is accepted as text', async ({ contactPage, xss }) => {
    await contactPage.send({ from: { ...fakeGuest(), firstName: `Qa${breakout}` }, subject: 'Webmaster', message: `${CONTACT_MESSAGE} ${payload}` });

    await expect(contactPage.successMessage).toBeVisible();
    expect(await xss.executed(), 'the payload executed').toBe(false);
  });
});
