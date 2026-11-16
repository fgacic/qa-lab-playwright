import type { Locator } from '@playwright/test';
import { step } from '@support/step';

/** What the shop tells the shopper about the cart, word for word. */
export const CART_MESSAGES = {
  added: 'Product added to shopping cart.',
  quantityUpdated: 'Product quantity updated.',
  lineDeleted: 'Product deleted.',
  atMost99: 'You can order at most 99 of this product.',
  serverError: 'Server Error',
  rentalPerHour: 'Item for rent, price per hour',
} as const;

export class CartRow {
  readonly title: Locator;
  readonly quantity: Locator;
  readonly unitPrice: Locator;
  readonly linePrice: Locator;
  readonly removeButton: Locator;
  /**
   * A notice on the line that the product cannot be bought: a whole element that says so ("Out of stock", "This product is
   * out of stock.", "Currently unavailable", "Sold out"), so a product named "... unavailable ..." is not one.
   */
  readonly outOfStock: Locator;

  constructor(readonly root: Locator) {
    this.title = root.getByTestId('product-title');
    this.quantity = root.getByRole('spinbutton');
    this.unitPrice = root.getByTestId('product-price');
    this.linePrice = root.getByTestId('line-price');
    this.outOfStock = root.getByText(/^(?:(?:this )?(?:product|item) is )?(?:currently )?(?:out of stock|sold out|unavailable|not available)[.!]?$/i);
    // The suite's one CSS locator: the remove control is an <a> with an icon, no href and
    // no accessible name, so neither a role nor a label can reach it (logged as A11Y-01).
    this.removeButton = root.locator('a.btn-danger');
  }
}

export class CartTable {
  readonly rows: Locator;
  readonly subtotal: Locator;
  readonly discount: Locator;
  readonly ecoDiscount: Locator;
  readonly total: Locator;

  constructor(readonly root: Locator) {
    this.rows = root.getByRole('row').filter({ has: root.page().getByRole('spinbutton') });
    this.subtotal = root.getByTestId('cart-subtotal');
    this.discount = root.getByTestId('cart-discount');
    this.ecoDiscount = root.getByTestId('cart-eco-discount');
    this.total = root.getByTestId('cart-total');
  }

  row(productName: string): CartRow {
    return new CartRow(this.rows.filter({ has: this.root.page().getByTestId('product-title').getByText(productName, { exact: true }) }));
  }

  /**
   * Quantity is saved on Enter (or blur), which sends PUT /carts/{id}/product/quantity. A string
   * is typed as it is, so a negative spec can type what a number cannot say (an empty field, "2.5").
   */
  @step('Change the quantity of "{0}" to {1}')
  async setQuantity(productName: string, quantity: number | string): Promise<void> {
    const input = this.row(productName).quantity;
    await input.fill(String(quantity));
    await input.press('Enter');
  }

  @step('Remove "{0}" from the cart')
  async remove(productName: string): Promise<void> {
    await this.row(productName).removeButton.click();
  }
}
