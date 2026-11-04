import { expect, mock, test, withMocks } from '@fixtures';
import { contactMessage, customer } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

test.describe('Admin orders (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each order with status and total', async ({ adminOrders, backOffice }) => {
    const row = adminOrders.table.row(backOffice.order.invoice_number);

    await expect(row).toContainText('AWAITING_FULFILLMENT');
    await expect(row).toContainText(`$${backOffice.order.total.toFixed(2)}`);
  });

  test('searching sends the term', async ({ adminOrders, apiMock }) => {
    const sent = apiMock.waitForRequest('QUERY', '/invoices/search');

    await adminOrders.search.searchFor('INV');

    expect((await sent).postDataJSON()).toMatchObject({ q: 'INV' });
  });

  test('an order shows its invoice, payment and lines', async ({ adminOrders, backOffice }) => {
    const order = await adminOrders.edit(backOffice.order.invoice_number);

    await expect(order.invoiceNumber).toHaveValue(backOffice.order.invoice_number);
    await expect(order.paymentMethod).toHaveValue('Cash on Delivery');
    await expect(order.billingCity).toHaveValue('Testville');
    await expect(order.lines).toHaveCount(1);
    await expect(order.lines.first()).toContainText(backOffice.product.name);
  });

  test('changing the status saves it and confirms', async ({ adminOrders, backOffice, apiMock }) => {
    const order = await adminOrders.edit(backOffice.order.invoice_number);
    await expect(order.status).toHaveValue('AWAITING_FULFILLMENT');
    const sent = apiMock.waitForRequest('PUT', /^\/invoices\/[^/]+\/status$/);

    await order.updateStatus('SHIPPED');

    expect((await sent).postDataJSON()).toMatchObject({ status: 'SHIPPED' });
    await expect(order.feedback.filter({ hasText: 'Status updated!' })).toBeVisible();
  });

  test.describe('when the status update fails', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/invoices\/[^/]+\/status$/, 500)));

    test('the admin is told the status was not saved', async ({ adminOrders, backOffice }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.status).toHaveValue('AWAITING_FULFILLMENT');

      await order.updateStatus('SHIPPED');

      await expect(order.page.getByRole('alert').filter({ hasText: /error|fail|not/i })).toBeVisible();
      await expect(order.feedback.filter({ hasText: 'Status updated!' })).toBeHidden();
    });
  });
});

test.describe('Admin users (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows name and email', async ({ adminUsers }) => {
    await expect(adminUsers.table.row(customer.email)).toContainText(`${customer.first_name} ${customer.last_name}`);
  });

  test('searching sends the term', async ({ adminUsers, apiMock }) => {
    const sent = apiMock.waitForRequest('QUERY', '/users/search');

    await adminUsers.search.searchFor('testy');

    expect((await sent).postDataJSON()).toMatchObject({ q: 'testy' });
  });

  test('a new user needs the required fields', { tag: ['@negative'] }, async ({ adminUsers }) => {
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText('Add User');

    await form.chrome.save();

    for (const message of ['First Name is required', 'Last Name is required', 'Date of birth is required', 'Street is required', 'City is required', 'Country is required', 'Email is required']) {
      await expect(form.chrome.alert(message)).toBeVisible();
    }
  });

  test('editing loads the user, including the account flags, and saves the change', async ({ adminUsers, apiMock }) => {
    const form = await adminUsers.edit(customer.email);
    await expect(form.email).toHaveValue(customer.email);
    await expect(form.enabled).toBeChecked();
    await expect(form.failedLoginAttempts).toHaveValue('0');
    const saved = apiMock.waitForRequest('PUT', `/users/${customer.id}`);

    await form.firstName.fill('Renamed');
    await form.enabled.uncheck();
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ first_name: 'Renamed', enabled: false, email: customer.email });
    await expect(form.chrome.alert('User saved!')).toBeVisible();
  });

  test('Delete removes the user', async ({ adminUsers, apiMock }) => {
    const deleted = apiMock.waitForRequest('DELETE', `/users/${customer.id}`);

    await adminUsers.table.delete(customer.email);

    await deleted;
    await expect(adminUsers.feedback.filter({ hasText: 'User deleted.' })).toBeVisible();
  });

  test.describe('when the email is already taken', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/users\/[^/]+$/, 422, { email: ['A customer with this email address already exists.'] })));

    test('the API error is shown', async ({ adminUsers }) => {
      const form = await adminUsers.edit(customer.email);
      await expect(form.email).toHaveValue(customer.email);

      await form.chrome.save();

      await expect(form.chrome.alert('A customer with this email address already exists.')).toBeVisible();
    });
  });
});

test.describe('Admin messages (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the inbox lists who wrote, about what, and the status', async ({ adminMessages }) => {
    await expect(adminMessages.table.row(contactMessage.name)).toContainText(contactMessage.subject);
    await expect(adminMessages.table.row(contactMessage.name)).toContainText('NEW');
  });

  test('a message opens with its text, and its status is saved on change', async ({ adminMessages, apiMock }) => {
    const message = await adminMessages.details(contactMessage.name);
    await expect(message.text(contactMessage.message)).toBeVisible();
    const sent = apiMock.waitForRequest('PUT', `/messages/${contactMessage.id}/status`);

    await message.setStatus('IN_PROGRESS');

    expect((await sent).postDataJSON()).toEqual({ status: 'IN_PROGRESS' });
  });

  test('a reply is sent', async ({ adminMessages, apiMock }) => {
    const message = await adminMessages.details(contactMessage.name);
    const sent = apiMock.waitForRequest('POST', `/messages/${contactMessage.id}/reply`);

    await message.reply('A mocked admin reply.');

    expect((await sent).postDataJSON()).toEqual({ message: 'A mocked admin reply.' });
  });

  test('an empty reply is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ adminMessages, apiMock }) => {
    knownBug('ADM-06', 'an empty admin reply is sent to the API ({"message":""}) instead of being validated.');
    const message = await adminMessages.details(contactMessage.name);
    const sent = apiMock.waitForRequest('POST', `/messages/${contactMessage.id}/reply`);

    await message.replyButton.click();

    expect((await sent).postDataJSON()).toEqual({ message: '' });
    await expect(message.page.getByRole('alert').filter({ hasText: /required/i })).toBeVisible({ timeout: 2_000 });
  });
});
