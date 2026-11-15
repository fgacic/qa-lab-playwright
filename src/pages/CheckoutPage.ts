import type { Page } from '@playwright/test';
import { CheckoutWizard } from '@components/checkout/CheckoutWizard';
import { step } from '@support/step';
import type { Address, Person } from '@support/test-data';
import { AppShell } from './AppShell';

export class CheckoutPage {
  readonly shell: AppShell;
  readonly wizard: CheckoutWizard;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.wizard = new CheckoutWizard(page);
  }

  get header() {
    return this.shell.header;
  }

  get toast() {
    return this.shell.toast;
  }

  get cart() {
    return this.wizard.cart;
  }

  get signIn() {
    return this.wizard.signIn;
  }

  get billing() {
    return this.wizard.billing;
  }

  get payment() {
    return this.wizard.payment;
  }

  /** From the cart to the payment step as a guest. Nothing is ordered yet. */
  @step('Go to the payment step as guest {0.email}')
  async proceedToPayment(guest: Person, address: Address): Promise<void> {
    await this.cart.proceed();
    await this.signIn.continueAsGuest(guest);
    await this.billing.enterAddress(address);
    await this.billing.proceed();
  }

  /** From the cart to the confirmation as a guest paying cash on delivery. */
  @step('Check out as guest {0.email}')
  async checkOutAsGuest(guest: Person, address: Address): Promise<void> {
    await this.proceedToPayment(guest, address);
    await this.payment.payOnDelivery();
  }

  @step('Open the cart')
  async open(): Promise<void> {
    await this.shell.goto('/checkout');
  }
}
