import { expect, type Locator, type Response } from '@playwright/test';
import { settleRequests } from '@support/settle';
import { step } from '@support/step';
import type { Address } from '@support/test-data';
import { FormField } from '../FormField';

/** What the postcode lookup answered: the status of its last answer and the address parts it suggested. */
export interface LookupAnswer {
  status: number;
  suggested: Partial<Pick<Address, 'street' | 'city' | 'state'>>;
}

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

  /**
   * Country, postcode and house number trigger GET /postcode-lookup, which fills the rest.
   * Returns the status of the last answer to arrive (not of the last request sent: a slow answer for an
   * earlier input may arrive after a later one, which is what BUG-41 pins) and what it suggested, so a caller
   * that needs the lookup to work can say so and knows which fields the page is about to fill.
   */
  @step('Look up the address for {0.postalCode} {0.houseNumber}')
  async lookUp(address: Pick<Address, 'country' | 'postalCode' | 'houseNumber'>): Promise<LookupAnswer> {
    const page = this.root.page();
    let last: Response | undefined;
    const answered = (response: Response) => {
      if (response.url().includes('/postcode-lookup')) last = response;
    };
    page.on('response', answered);
    try {
      await settleRequests(page, '/postcode-lookup', async () => {
        await this.country.input.selectOption(address.country);
        await this.postalCode.input.fill(address.postalCode);
        await this.houseNumber.input.fill(address.houseNumber);
      });
    } finally {
      page.off('response', answered);
    }
    const status = last?.status() ?? 0;
    const body = last?.ok() ? ((await last.json().catch(() => ({}))) as Partial<Record<'street' | 'city' | 'state', string>>) : {};
    return { status, suggested: { street: body.street, city: body.city, state: body.state } };
  }

  /**
   * Enter an address: look it up, keep what the lookup suggests, and type only what it left
   * empty. Keeping the suggestion matters: the API refuses an order whose city does not belong
   * to the country (422), so an invented city cannot be typed over a real one. A lookup that
   * failed throws: typing the whole address by hand would hide a broken lookup. That is a
   * decision, not an oversight: a lookup outage is an environment failure, so it surfaces as an
   * error naming the status (a test about a failing lookup calls `lookUp` and `completeAddress`
   * itself), and specs that are not about the lookup mock it so an outage cannot fail them. What the lookup
   * suggested is awaited in the field (web-first) rather than read once, so the address is
   * complete, and the page done filling it, when this returns.
   */
  @step('Enter the billing address')
  async enterAddress(address: Address): Promise<void> {
    const { status, suggested } = await this.lookUp(address);
    if (status < 200 || status >= 300) throw new Error(`The postcode lookup for ${address.postalCode} ${address.houseNumber} answered ${status || 'nothing'}`);
    // `lookUp` returned once the lookup's requests went quiet, so `suggested` is the answer the page applies last and each
    // field is awaited for it. Reading the fields at once would race the page, which fills them a moment after the answer (a
    // slower answer for an earlier input can still land later, BUG-41: the quiet window is what keeps it out of this read).
    for (const [field, key] of [[this.street, 'street'], [this.city, 'city'], [this.state, 'state']] as const) {
      const fromLookup = suggested[key];
      if (fromLookup) await expect(field.input).toHaveValue(fromLookup);
      else await field.input.fill(address[key]);
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
