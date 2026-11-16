import { expect, mock, test, withMocks } from '@fixtures';
import { ADMIN_MESSAGES, allowLoggedFailure, appearsWithin } from '@pages/admin/alerts';
import { ORDER_STATUSES } from '@pages/admin/AdminPages';
import { ORDER_STATUS, dollars, orderLine, orderPayment, orderTotalField, paginated } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

test.describe('Admin orders (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each order with status and total', async ({ adminOrders, backOffice }) => {
    const row = adminOrders.table.row(backOffice.order.invoice_number);

    await expect(row).toContainText(backOffice.order.status);
    await expect(row).toContainText(dollars(backOffice.order.total));
  });

  test('searching sends the term and lists the matches', async ({ adminOrders, backOffice, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { ...backOffice.order, id: '01QALABORDERHIT00000000000', invoice_number: 'INV-2026999991' };
    await apiMock.use(mock.respond('QUERY', '/invoices/search', paginated([match])));
    const sent = apiMock.waitForRequest('QUERY', '/invoices/search');

    await adminOrders.search.searchFor('INV-2026999991');

    expect((await sent).postDataJSON()).toMatchObject({ q: 'INV-2026999991' });
    await expect(adminOrders.table.row(match.invoice_number)).toBeVisible();
    await expect(adminOrders.table.row(backOffice.order.invoice_number)).toHaveCount(0);
  });

  test('an order shows its invoice, payment and lines', async ({ adminOrders, backOffice }) => {
    const order = await adminOrders.edit(backOffice.order.invoice_number);

    await expect(order.invoiceNumber).toHaveValue(backOffice.order.invoice_number);
    await expect(order.total).toHaveValue(orderTotalField(backOffice.order.total));
    await expect(order.paymentMethod).toHaveValue(orderPayment.label);
    await expect(order.billingCity).toHaveValue(backOffice.order.billing_city);
    await expect(order.lines).toHaveCount(1);
    // Quantity, product, unit price and line total, as the fixed order line has them.
    await expect(order.lineCells()).toHaveText([String(orderLine.quantity), backOffice.product.name, dollars(orderLine.unitPrice), dollars(orderLine.total)]);
  });

  // The order's current status is not offered as an option, so every other status is set in turn.
  for (const status of ORDER_STATUSES.filter((s) => s !== ORDER_STATUS)) {
    test(`changing the status to ${status} saves it and confirms`, async ({ adminOrders, backOffice, apiMock }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.status).toHaveValue(backOffice.order.status);
      const sent = apiMock.waitForRequest('PUT', /^\/invoices\/[^/]+\/status$/);

      await order.updateStatus(status);

      expect((await sent).postDataJSON()).toMatchObject({ status });
      await expect(order.feedback.filter({ hasText: ADMIN_MESSAGES.statusUpdated })).toBeVisible();
    });
  }

  test.describe('when the order cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', /^\/invoices\/[^/]+$/, 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the page does not claim the invoice is gone', async ({ adminOrders, backOffice, apiMock }) => {
      knownBug('ADM-13', 'an order whose load fails (500) is reported as "This invoice doesn\'t exist.", the message for a missing one.');
      const failed = apiMock.waitForResponse('GET', /^\/invoices\/[^/]+$/);

      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await failed;
      // Drawn in every state of the page, so whatever the page goes on to say about the failed load, it is not the first thing on it.
      await expect(order.backLink).toBeVisible();

      // A server error is not "not found": any other wording, an alert or nothing would do. The pin only refuses the wrong claim,
      // and the claim may be drawn a moment after the link, so it is watched for over a window.
      expect(await appearsWithin(order.notFoundNotice, BUG_TIMEOUT), 'ADM-13: a failed order load does not say the invoice does not exist').toBe(false);
    });
  });

  // Refused as a conflict (the order changed meanwhile), as invalid, and failed outright: each is shown, none is reported as saved.
  for (const status of [409, 422, 500]) {
    test.describe(`when the status update is answered ${status}`, { tag: ['@negative'] }, () => {
      test.use(withMocks(mock.fail('PUT', /^\/invoices\/[^/]+\/status$/, status)));
      test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

      test('the admin is told the status was not saved', async ({ adminOrders, backOffice }) => {
        const order = await adminOrders.edit(backOffice.order.invoice_number);
        await expect(order.status).toHaveValue(backOffice.order.status);

        await order.updateStatus('SHIPPED');

        // The page shows the raw HTTP error today; any alert would do, as long as the update is not confirmed.
        await expect(order.failure).toBeVisible();
        await expect(order.feedback.filter({ hasText: ADMIN_MESSAGES.statusUpdated })).toBeHidden();
      });
    });
  }
});
