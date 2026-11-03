import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export class CartRow {
  readonly title: Locator;
  readonly quantity: Locator;
  readonly unitPrice: Locator;
  readonly linePrice: Locator;
  readonly removeButton: Locator;

  constructor(readonly root: Locator) {
    this.title = root.getByTestId('product-title');
    this.quantity = root.getByRole('spinbutton');
    this.unitPrice = root.getByTestId('product-price');
    this.linePrice = root.getByTestId('line-price');
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

  /** Quantity is saved on Enter (or blur), which sends PUT /carts/{id}/product/quantity. */
  @step('Change the quantity of "{0}" to {1}')
  async setQuantity(productName: string, quantity: number): Promise<void> {
    const input = this.row(productName).quantity;
    await input.fill(String(quantity));
    await input.press('Enter');
  }

  @step('Remove "{0}" from the cart')
  async remove(productName: string): Promise<void> {
    await this.row(productName).removeButton.click();
  }
}
