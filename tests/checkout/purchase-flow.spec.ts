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
 */
test.describe('Purchase flows', { tag: ['@flow'] }, () => {
  test('browse, buy one product as a guest and get an invoice number', { tag: ['@smoke'] }, async ({ homePage, apiMock }) => {
    const { name, productPage } = await homePage.openFirstInStockProduct();
    await productPage.addToCart(2);
    await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();

    const checkout = await productPage.openCart();
    await expect(checkout.cart.table.row(name).quantity).toHaveValue('2');
    const order = apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest');
    await checkout.checkOutAsGuest(fakeGuest(), fakeAddress());

    const { response, json: invoice } = await order;
    expect(response.status(), JSON.stringify(invoice)).toBe(201);
    await expect(checkout.wizard.confirmation).toHaveText(`Thanks for your order! Your invoice number is ${invoice.invoice_number}.`);
    expect(invoice.invoice_number).toMatch(/^INV-\d{10}$/);
    await expect(checkout.header.cartLink).toHaveCount(0);
  });

  test('search, fill a cart with three products, change and remove lines, then order', async ({ homePage, apiMock }) => {
    const added: string[] = [];
    for (const term of ['pliers', 'hammer', 'saw']) {
      await homePage.search.searchFor(term);
      await expect(homePage.search.caption).toHaveText(`Searched for: ${term}`);
      const { name, productPage } = await homePage.openFirstInStockProduct();
      await productPage.addToCart();
      await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();
      added.push(name);
      await productPage.backToShop();
    }
    const [kept, removed, alsoKept] = added;

    const checkout = await homePage.openCart();
    const { table } = checkout.cart;
    await expect(table.rows).toHaveCount(3);
    await table.setQuantity(kept, 3);
    await expect(checkout.toast.message('Product quantity updated.')).toBeVisible();
    await table.remove(removed);
    await expect(table.rows).toHaveCount(2);
    await expect(checkout.header.cartLink).toHaveText('4');

    // What the cart shows is what the order must charge.
    const keptLine = Number((await table.row(kept).linePrice.innerText()).replace(/[^0-9.]/g, ''));
    const otherLine = Number((await table.row(alsoKept).linePrice.innerText()).replace(/[^0-9.]/g, ''));
    await expect(table.total).toShowAmount(keptLine + otherLine);
    const cartTotal = Number((await table.total.innerText()).replace(/[^0-9.]/g, ''));

    const address = fakeAddress();
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
    await checkout.billing.enterAddress(address);
    const billedCity = await checkout.billing.city.input.inputValue();
    await checkout.billing.proceed();
    const order = apiMock.waitForResponse<GuestInvoice>('POST', '/invoices/guest');
    await checkout.payment.payWith('cash-on-delivery');

    const { response, json: invoice } = await order;
    expect(response.status(), JSON.stringify(invoice)).toBe(201);
    await expect(checkout.wizard.confirmation).toContainText(invoice.invoice_number);
    expect(invoice.total).toBeCloseTo(cartTotal, 2);
    expect(invoice.billing_city, 'the order is billed to the address on screen').toBe(billedCity);
  });
});
