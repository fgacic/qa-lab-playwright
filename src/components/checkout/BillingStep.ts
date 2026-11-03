import type { Locator } from '@playwright/test';
import { settleRequests } from '@support/settle';
import { step } from '@support/step';
import type { Address } from '@support/test-data';
import { FormField } from '../FormField';

export class BillingStep {
  readonly heading: Locator;
  readonly country: FormField;
  readonly postalCode: FormField;
  readonly houseNumber: FormField;
  readonly street: FormField;
  readonly city: FormField;
  readonly state: FormField;
  readonly lookupHint: Locator;
  readonly lookupError: Locator;
  readonly proceedButton: Locator;

  constructor(private readonly root: Locator) {
    this.heading = root.getByRole('heading', { name: 'Billing Address' });
    this.country = new FormField(root, 'Country');
    this.postalCode = new FormField(root, 'Postal code');
    this.houseNumber = new FormField(root, 'House number');
    this.street = new FormField(root, 'Street');
    this.city = new FormField(root, 'City');
    this.state = new FormField(root, 'State');
    this.lookupHint = root.getByTestId('postcode-lookup-hint');
    this.lookupError = root.getByTestId('postcode-lookup-error');
    this.proceedButton = root.getByTestId('proceed-3');
  }

  /** Country, postcode and house number trigger GET /postcode-lookup, which fills the rest. */
  @step('Look up the address for {0.postalCode} {0.houseNumber}')
  async lookUp(address: Pick<Address, 'country' | 'postalCode' | 'houseNumber'>): Promise<void> {
    await settleRequests(this.root.page(), '/postcode-lookup', async () => {
      await this.country.input.selectOption(address.country);
      await this.postalCode.input.fill(address.postalCode);
      await this.houseNumber.input.fill(address.houseNumber);
    });
  }

  /**
   * Enter an address: look it up, keep what the lookup suggests, and type only what it left
   * empty. Keeping the suggestion matters: the API refuses an order whose city does not belong
   * to the country (422), so an invented city cannot be typed over a real one.
   */
  @step('Enter the billing address')
  async enterAddress(address: Address): Promise<void> {
    await this.lookUp(address);
    for (const [field, value] of [[this.street, address.street], [this.city, address.city], [this.state, address.state]] as const) {
      if (!(await field.input.inputValue())) await field.input.fill(value);
    }
  }

  /** Type street, city and state, e.g. after a lookup that found nothing. */
  @step('Type the street, city and state')
  async completeAddress(address: Pick<Address, 'street' | 'city' | 'state'>): Promise<void> {
    await this.street.input.fill(address.street);
    await this.city.input.fill(address.city);
    await this.state.input.fill(address.state);
  }

  @step('Proceed from billing to payment')
  async proceed(): Promise<void> {
    await this.proceedButton.click();
  }
}
