import { CART_MESSAGES as MESSAGES } from '@components/CartTable';
import { searchedFor } from '@components/SearchBar';
import { expect, mock, test, withMocks } from '@fixtures';
import { postcodeLookupMock } from '@fixtures/mocks';
import { twoProductCart } from '@fixtures/pages';
import { holdAnswers } from '@support/answer-gate';
import { knownBug } from '@support/known-bug';
import { acceptedGuestInvoice } from '@support/payloads';
import { fakeAddress, fakeGuest } from '@support/test-data';

/** What the three-product flow changes: the first product goes to this quantity, the second is removed. */
const KEPT_QUANTITY = 3;
/** How many of the product the browse-and-buy journeys put in the cart. */
const ORDERED_QUANTITY = 2;

/** The cart's discount for an eco-friendly product: 5% off the subtotal (the cart specs hold the rule itself to literal figures). */
const ECO_DISCOUNT = 0.05;

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
 * The real orders use the real postcode lookup on purpose: the shop refuses an order whose city does
 * not belong to the country (422), so only a city the lookup returned makes a valid invoice. Everything
 * else answers the lookup with a mock, so an outage of it cannot fail a journey that is not about it.
 */
test.describe('Purchase flows', { tag: ['@flow'] }, () => {
  test.describe('up to the payment step', () => {
    test.use(withMocks(postcodeLookupMock));

    test('browse, add a product and reach the payment step as a guest', { tag: ['@smoke'] }, async ({ homePage }) => {
      const { name, productPage } = await homePage.openFirstInStockProduct();
      await productPage.addToCart(ORDERED_QUANTITY);
      await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();

      const checkout = await productPage.openCart();
      await expect(checkout.cart.table.row(name).quantity).toHaveValue(String(ORDERED_QUANTITY));
      await checkout.proceedToPayment(fakeGuest(), fakeAddress());

      await expect(checkout.payment.heading).toBeVisible();
      await expect(checkout.payment.checkPaymentButton).toBeDisabled();
    });
  });

  test('browse, buy one product as a guest and get an invoice number', { tag: ['@smoke', '@self-hosted'] }, async ({ homePage, apiMock }) => {
    const { name, productPage } = await homePage.openFirstInStockProduct();
    await productPage.addToCart(ORDERED_QUANTITY);
    await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();

    const checkout = await productPage.openCart();
    await expect(checkout.cart.table.row(name).quantity).toHaveValue(String(ORDERED_QUANTITY));
    const [{ response, json: invoice }] = await Promise.all([
      apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest'),
      checkout.checkOutAsGuest(fakeGuest(), fakeAddress()),
    ]);

    expect(response.status(), JSON.stringify(invoice)).toBe(201);
    await expect(checkout.wizard.confirmationFor(invoice.invoice_number)).toBeVisible();
    expect(invoice.invoice_number).toMatch(/^INV-\d{10}$/);
    await expect(checkout.header.cartLink).toHaveCount(0);
  });

  test('search, fill a cart with three products, then change a quantity and remove a line', async ({ homePage, catalog, api }) => {
    // Three distinct products, chosen by the catalogue and not by what a search happens to list first.
    const kept = await catalog.inStock();
    const removed = await catalog.anotherInStock();
    const alsoKept = await api.inStockProduct([kept.id, removed.id]);
    for (const product of [kept, removed, alsoKept]) {
      await homePage.search.searchFor(product.name);
      await expect(homePage.search.caption).toHaveText(searchedFor(product.name));
      const productPage = await homePage.openProduct(product.name);
      await productPage.addToCart();
      await expect(productPage.toast.message(MESSAGES.added)).toBeVisible();
      await productPage.backToShop();
    }

    const checkout = await homePage.openCart();
    const { table } = checkout.cart;
    await expect(table.rows).toHaveCount(3);
    await table.setQuantity(kept.name, KEPT_QUANTITY);
    await expect(checkout.toast.message(MESSAGES.quantityUpdated)).toBeVisible();
    await table.remove(removed.name);
    await expect(table.rows).toHaveCount(2);
    const units = KEPT_QUANTITY + 1;
    await expect(checkout.header.cartLink).toHaveText(String(units));

    // The lines come from the catalogue's prices, and the saved cart (not the page) holds both edits.
    const expectEdits = async (when: string) => {
      await expect(table.rows, when).toHaveCount(2);
      await expect(table.row(kept.name).quantity, when).toHaveValue(String(KEPT_QUANTITY));
      await expect(table.row(kept.name).linePrice, when).toShowAmount(kept.price * KEPT_QUANTITY);
      await expect(table.row(alsoKept.name).linePrice, when).toShowAmount(alsoKept.price);
      await expect(table.row(removed.name).title, when).toHaveCount(0);
      await expect(checkout.header.cartLink, when).toHaveText(String(units));
    };
    await expectEdits('on the page');
    await checkout.page.reload();
    await expectEdits('after a reload');
  });

  test.describe('ordering what the cart shows', { tag: ['@self-hosted'] }, () => {
    test.use({ cartItems: twoProductCart });

    test('the invoice charges the cart total and bills the address entered', async ({ checkout, cartItems, apiMock }) => {
      const { table } = checkout.cart;
      // Neither product is eco-friendly, so no discount applies and the cart total is the sum of its lines.
      const cartTotal = cartItems.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);
      await expect(table.total).toShowAmount(cartTotal);

      await checkout.cart.proceed();
      await checkout.signIn.continueAsGuest(fakeGuest());
      await checkout.billing.enterAddress(fakeAddress());
      // enterAddress returns once the lookup's answer is in the fields, so the city read is the settled one.
      const billedCity = await checkout.billing.city.input.inputValue();
      await checkout.billing.proceed();
      const [{ response, json: invoice }] = await Promise.all([
        apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest'),
        checkout.payment.payOnDelivery(),
      ]);

      expect(response.status(), JSON.stringify(invoice)).toBe(201);
      await expect(checkout.wizard.confirmation).toContainText(invoice.invoice_number);
      expect(invoice.total).toBeCloseTo(cartTotal, 2);
      expect(invoice.billing_city, 'the order is billed to the address on screen').toBe(billedCity);
    });
  });

  test.describe('when Confirm is double-clicked', { tag: ['@mocked', '@bug'] }, () => {
    // The check and the lookup are answered, and so is the cart's deletion: the order is answered by the gate below, so no real order is placed.
    test.use({ ...withMocks(postcodeLookupMock, mock.respond('POST', '/payment/check', { message: 'Payment was successful' }), mock.respond('DELETE', /^\/carts\/[^/]+$/, undefined, 204)), refuseUnmockedWrites: true });

    test('a double click on Confirm places one order', async ({ checkout, page }) => {
      knownBug('BUG-46', 'a double click on Confirm sends the order twice, so two invoices are created for one cart.');
      // Held until both clicks have landed: answered at once, the page may replace Confirm before the second click (it does on WebKit) and one order is sent whatever the page does.
      const order = await holdAnswers(page, /\/invoices\/guest$/, acceptedGuestInvoice);
      await checkout.proceedToPayment(fakeGuest(), fakeAddress());
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();
      await expect(checkout.payment.confirmButton).toBeEnabled();

      await checkout.payment.confirmWithDoubleClick();
      order.release();

      await expect(checkout.wizard.confirmationFor(acceptedGuestInvoice.invoice_number)).toBeVisible();
      expect(order.reached, 'BUG-46: one order is sent for one cart').toBe(1);
    });
  });

  test('browser Back from the sign-in step leaves the checkout, and Forward returns to the cart with its lines', async ({ checkout, cartItems, page }) => {
    const [{ product }] = cartItems;

    await checkout.walkThenBackAndForward(async () => {
      await expect(checkout.cart.table.row(product.name).title).toBeVisible();
      await checkout.cart.proceed();
      await expect(checkout.signIn.guestTab).toBeVisible();
    });

    await expect(page).toHaveURL(/\/checkout$/);
    await expect(checkout.cart.table.row(product.name).title, 'the cart still holds its line').toBeVisible();
    await expect(checkout.cart.proceedButton).toBeEnabled();
  });

  test.describe('ordering an eco-friendly product', { tag: ['@self-hosted'] }, () => {
    test.use({ cartItems: async ({ catalog }, use) => use([{ product: await catalog.eco(), quantity: 2 }]) });

    test('the invoice honours the 5% eco-friendly discount the cart showed', async ({ checkout, cartItems, apiMock }) => {
      const [{ product, quantity }] = cartItems;
      // The cart shows 5% off the subtotal before the order is placed (cart.spec.ts checks that rule with literal figures); the invoice must charge that same total.
      const subtotal = product.price * quantity;
      const discounted = subtotal * (1 - ECO_DISCOUNT);
      await expect(checkout.cart.table.total).toShowAmount(discounted);

      const [{ response, json: invoice }] = await Promise.all([
        apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest'),
        checkout.checkOutAsGuest(fakeGuest(), fakeAddress()),
      ]);

      expect(response.status(), JSON.stringify(invoice)).toBe(201);
      await expect(checkout.wizard.confirmation).toContainText(invoice.invoice_number);
      expect(invoice.total, 'the invoice charges the discounted total the cart showed').toBeCloseTo(discounted, 2);
    });
  });
});
