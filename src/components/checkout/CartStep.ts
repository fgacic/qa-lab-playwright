import type { Locator } from '@playwright/test';
import { step } from '@support/step';
import { CartTable } from '../CartTable';

export class CartStep {
  readonly table: CartTable;
  readonly emptyMessage: Locator;
  readonly continueShoppingButton: Locator;
  readonly proceedButton: Locator;

  constructor(root: Locator) {
    this.table = new CartTable(root.getByRole('table'));
    this.emptyMessage = root.getByText('The cart is empty. Nothing to display.');
    this.continueShoppingButton = root.getByRole('button', { name: 'Continue Shopping' });
    this.proceedButton = root.getByTestId('proceed-1');
  }

  @step('Continue shopping')
  async continueShopping(): Promise<void> {
    await this.continueShoppingButton.click();
  }

  @step('Proceed from the cart to sign in')
  async proceed(): Promise<void> {
    await this.proceedButton.click();
  }
}
