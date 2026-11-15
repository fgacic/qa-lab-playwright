import { PAYMENT_METHODS } from '@components/checkout/PaymentStep';
import { expect, test } from '@fixtures';
import { fakeAddress, fakeGuest } from '@support/test-data';

/** What the shop tells the shopper, word for word. */
const MESSAGES = { added: 'Product added to shopping cart.', quantityUpdated: 'Product quantity updated.' } as const;

interface GuestInvoice {
  invoice_number: string;
  total: number;
  billing_city: string;
}

/**
 * End-to-end purchases as a guest, through the real shop and API. Orders are placed with
 * Cash on Delivery and an obviously fake example.com guest: no financial details are used.
 * Placing an order leaves a record, so those flows run on the self-hosted shop only
 * (@self-hosted); the journeys up to the payment step write only anonymous carts and run everywhere.
 */
test.describe('Purchase flows', { tag: ['@flow'] }, () => {
  test('browse, add a product and reach the payment step as a guest', { tag: ['@smoke'] }, async ({ homePage }) => {
    const { name, productPage } = await homePage.openFirstInStockProduct();
    await productPage.addToCart(2);
    await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();

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
    await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();

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

  test('search, fill a cart with three products, then change a quantity and remove a line', async ({ homePage, api }) => {
    const added: { id: string; name: string }[] = [];
    for (const term of ['pliers', 'hammer', 'saw']) {
      await homePage.search.searchFor(term);
      await expect(homePage.search.caption).toHaveText(`Searched for: ${term}`);
      const { id, name, productPage } = await homePage.openFirstInStockProduct();
      await productPage.addToCart();
      await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();
      added.push({ id, name });
      await productPage.backToShop();
    }
    const [kept, removed, alsoKept] = added;

    const checkout = await homePage.openCart();
    const { table } = checkout.cart;
    await expect(table.rows).toHaveCount(3);
    await table.setQuantity(kept.name, 3);
    await expect(checkout.toast.message(MESSAGES.quantityUpdated)).toBeVisible();
    await table.remove(removed.name);
    await expect(table.rows).toHaveCount(2);
    await expect(checkout.header.cartLink).toHaveText('4');

    // The lines come from the catalogue's prices.
    const [keptProduct, alsoKeptProduct] = await Promise.all([api.product(kept.id), api.product(alsoKept.id)]);
    await expect(table.row(kept.name).linePrice).toShowAmount(keptProduct.price * 3);
    await expect(table.row(alsoKept.name).linePrice).toShowAmount(alsoKeptProduct.price);
  });

  test.describe('ordering what the cart shows', { tag: ['@self-hosted'] }, () => {
    test.use({
      cartItems: async ({ catalog }, use) =>
        use([
          { product: await catalog.inStock(), quantity: 3 },
          { product: await catalog.anotherInStock(), quantity: 1 },
        ]),
    });

    test('the invoice charges the cart total and bills the address entered', async ({ checkout, cartItems, apiMock }) => {
      const { table } = checkout.cart;
      // The total also depends on discounts (eco products), so the order must charge the cart's own
      // figure. It is read once every line shows its catalogue price, i.e. once the cart has rendered.
      for (const { product, quantity } of cartItems) await expect(table.row(product.name).linePrice).toShowAmount(product.price * quantity);
      const cartTotal = Number((await table.total.innerText()).replace(/[^0-9.]/g, ''));

      await checkout.cart.proceed();
      await checkout.signIn.continueAsGuest(fakeGuest());
      await checkout.billing.enterAddress(fakeAddress());
      // enterAddress returns once the lookup's answer is in the fields, so the city read is the settled one.
      await expect(checkout.billing.city.input).not.toHaveValue('');
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
});
