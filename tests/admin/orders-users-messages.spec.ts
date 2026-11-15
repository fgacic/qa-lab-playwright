import { expect, mock, test, withMocks } from '@fixtures';
import { ORDER_STATUSES } from '@pages/admin/AdminPages';
import { contactMessage, customer, orderPayment, paginated } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

test.describe('Admin orders (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each order with status and total', async ({ adminOrders, backOffice }) => {
    const row = adminOrders.table.row(backOffice.order.invoice_number);

    await expect(row).toContainText(backOffice.order.status);
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
    await expect(order.total).toHaveValue(`$ ${backOffice.order.total.toFixed(2)}`);
    await expect(order.paymentMethod).toHaveValue(orderPayment.label);
    await expect(order.billingCity).toHaveValue(backOffice.order.billing_city);
    await expect(order.lines).toHaveCount(1);
    await expect(order.lines.first()).toContainText(backOffice.product.name);
  });

  // The order's current status is not offered as an option, so every other status is set in turn.
  for (const status of ORDER_STATUSES.filter((s) => s !== 'AWAITING_FULFILLMENT')) {
    test(`changing the status to ${status} saves it and confirms`, async ({ adminOrders, backOffice, apiMock }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.status).toHaveValue(backOffice.order.status);
      const sent = apiMock.waitForRequest('PUT', /^\/invoices\/[^/]+\/status$/);

      await order.updateStatus(status);

      expect((await sent).postDataJSON()).toMatchObject({ status });
      await expect(order.feedback.filter({ hasText: 'Status updated!' })).toBeVisible();
    });
  }

  test.describe('when the status update fails', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/invoices\/[^/]+\/status$/, 500)));

    test('the admin is told the status was not saved', async ({ adminOrders, backOffice }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.status).toHaveValue(backOffice.order.status);

      await order.updateStatus('SHIPPED');

      // The page shows the raw HTTP error; the mocked 500 is what must be in it.
      await expect(order.feedback.filter({ hasText: '500 Internal Server Error' })).toBeVisible();
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
    // Once deleted, the list the page reloads no longer has the user.
    await apiMock.use(mock.respond('GET', '/users', paginated([])));
    await expect(adminUsers.table.row(customer.email)).toBeVisible();
    const deleted = apiMock.waitForRequest('DELETE', `/users/${customer.id}`);

    await adminUsers.table.delete(customer.email);

    await deleted;
    await expect(adminUsers.feedback.filter({ hasText: 'User deleted.' })).toBeVisible();
    await expect(adminUsers.table.row(customer.email)).toHaveCount(0);
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

  test('an empty reply is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ adminMessages, sentRequests }) => {
    knownBug('ADM-06', 'an empty admin reply is sent to the API ({"message":""}) instead of being validated.');
    const message = await adminMessages.details(contactMessage.name);
    const replies = sentRequests('POST', `/messages/${contactMessage.id}/reply`);

    await message.replyButton.click();

    await expect(message.feedback.filter({ hasText: /required/i }), 'ADM-06: the form says a reply is required').toBeVisible({ timeout: 2_000 });
    expect(replies.count, 'ADM-06: no empty reply is sent').toBe(0);
  });
});
