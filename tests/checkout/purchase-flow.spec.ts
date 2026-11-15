import { PAYMENT_METHODS } from '@components/checkout/PaymentStep';
import { expect, test } from '@fixtures';
import { fakeAddress, fakeGuest } from '@support/test-data';

interface GuestInvoice {
  invoice_number: string;
  total: number;
  billing_city: string;
}

/**
 * End-to-end purchases as a guest, through the real shop and API. Orders are placed with
 * Cash on Delivery and an obviously fake example.com guest: no financial details are used.
 * Placing an order leaves a record, so those flows run on the self-hosted shop only
 * (@self-hosted); the journey up to the payment step writes nothing and runs everywhere.
 */
test.describe('Purchase flows', { tag: ['@flow'] }, () => {
  test('browse, add a product and reach the payment step as a guest', { tag: ['@smoke'] }, async ({ homePage }) => {
    const { name, productPage } = await homePage.openFirstInStockProduct();
    await productPage.addToCart(2);
    await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();

    const checkout = await productPage.openCart();
    await expect(checkout.cart.table.row(name).quantity).toHaveValue('2');
    await checkout.proceedToPayment(fakeGuest(), fakeAddress());

    await expect(checkout.payment.heading).toBeVisible();
    await expect(checkout.payment.method.getByRole('option')).toHaveCount(Object.keys(PAYMENT_METHODS).length + 1);
    await expect(checkout.payment.checkPaymentButton).toBeDisabled();
  });

  test('browse, buy one product as a guest and get an invoice number', { tag: ['@smoke', '@self-hosted'] }, async ({ homePage, apiMock }) => {
    const { name, productPage } = await homePage.openFirstInStockProduct();
    await productPage.addToCart(2);
    await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();

    const checkout = await productPage.openCart();
    await expect(checkout.cart.table.row(name).quantity).toHaveValue('2');
    const [{ response, json: invoice }] = await Promise.all([
      apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest'),
      checkout.checkOutAsGuest(fakeGuest(), fakeAddress()),
    ]);

    expect(response.status(), JSON.stringify(invoice)).toBe(201);
    await expect(checkout.wizard.confirmation).toHaveText(`Thanks for your order! Your invoice number is ${invoice.invoice_number}.`);
    expect(invoice.invoice_number).toMatch(/^INV-\d{10}$/);
    await expect(checkout.header.cartLink).toHaveCount(0);
  });

  test('search, fill a cart with three products, change and remove lines, then order', { tag: ['@self-hosted'] }, async ({ homePage, api, apiMock }) => {
    const added: { id: string; name: string }[] = [];
    for (const term of ['pliers', 'hammer', 'saw']) {
      await homePage.search.searchFor(term);
      await expect(homePage.search.caption).toHaveText(`Searched for: ${term}`);
      const { id, name, productPage } = await homePage.openFirstInStockProduct();
      await productPage.addToCart();
      await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();
      added.push({ id, name });
      await productPage.backToShop();
    }
    const [kept, removed, alsoKept] = added;

    const checkout = await homePage.openCart();
    const { table } = checkout.cart;
    await expect(table.rows).toHaveCount(3);
    await table.setQuantity(kept.name, 3);
    await expect(checkout.toast.message('Product quantity updated.')).toBeVisible();
    await table.remove(removed.name);
    await expect(table.rows).toHaveCount(2);
    await expect(checkout.header.cartLink).toHaveText('4');

    // The lines come from the catalogue's prices. The total also depends on discounts (eco
    // products), so for it the cart's own figure is what the order must charge.
    const [keptProduct, alsoKeptProduct] = await Promise.all([api.product(kept.id), api.product(alsoKept.id)]);
    await expect(table.row(kept.name).linePrice).toShowAmount(keptProduct.price * 3);
    await expect(table.row(alsoKept.name).linePrice).toShowAmount(alsoKeptProduct.price);
    const cartTotal = Number((await table.total.innerText()).replace(/[^0-9.]/g, ''));

    const address = fakeAddress();
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
    await checkout.billing.enterAddress(address);
    const billedCity = await checkout.billing.city.input.inputValue();
    await checkout.billing.proceed();
    const [{ response, json: invoice }] = await Promise.all([
      apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest'),
      checkout.payment.payWith('cash-on-delivery'),
    ]);

    expect(response.status(), JSON.stringify(invoice)).toBe(201);
    await expect(checkout.wizard.confirmation).toContainText(invoice.invoice_number);
    expect(invoice.total).toBeCloseTo(cartTotal, 2);
    expect(invoice.billing_city, 'the order is billed to the address on screen').toBe(billedCity);
  });
});
