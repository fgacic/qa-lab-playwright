import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import { reportedFailure } from './alerts';

/** Brand, category and image start on a placeholder option (index 0): the first real record is index 1. */
const FIRST_RECORD = 1;

/**
 * What every back-office form shares: heading, Id, Save, Back, and the alerts that carry both
 * validation labels and "… saved!" messages. Each form holds one (composition, no base class).
 */
export class AdminFormChrome {
  readonly heading: Locator;
  readonly id: Locator;
  readonly saveButton: Locator;
  readonly backLink: Locator;
  /** Validation labels and the "… saved!" / error messages are all ARIA alerts (the brand form's per-field errors also have test ids). */
  readonly alerts: Locator;
  /** What the form says when a request fails, in whatever form (an alert, or the site's plain error text). */
  readonly failure: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 2 });
    this.id = page.getByRole('textbox', { name: 'Id', exact: true });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    this.backLink = page.getByRole('link', { name: 'Back' });
    this.alerts = page.getByRole('alert');
    this.failure = reportedFailure(page);
  }

  alert(text: string | RegExp): Locator {
    return this.alerts.filter({ hasText: text });
  }

  /**
   * The "<label> is required" validation message. Only the brand form's fields carry an error test id
   * (`FormField.error`); the category, product and user forms render the same alerts with no id, so
   * theirs are reached by the message, through this one helper.
   */
  required(label: string): Locator {
    return this.alert(`${label} is required`);
  }

  @step('Save the form')
  async save(): Promise<void> {
    await this.saveButton.click();
  }
}

export interface BrandInput {
  name: string;
  slug: string;
}

export class AdminBrandForm {
  readonly chrome: AdminFormChrome;
  readonly name: FormField;
  readonly slug: FormField;

  constructor(readonly page: Page) {
    this.chrome = new AdminFormChrome(page);
    const body = page.locator('body');
    this.name = new FormField(body, 'Name', 'name-error');
    this.slug = new FormField(body, 'Slug', 'slug-error');
  }

  @step('Fill in brand "{0.name}"')
  async fillIn(brand: BrandInput): Promise<void> {
    await this.name.input.fill(brand.name);
    await this.slug.input.fill(brand.slug);
  }
}

export interface CategoryInput {
  name: string;
  slug: string;
  parent?: string;
}

export class AdminCategoryForm {
  readonly chrome: AdminFormChrome;
  readonly parent: Locator;
  /** No error test id on this form: its "... is required" alerts are reached through `chrome.required`. */
  readonly name: FormField;
  readonly slug: FormField;

  constructor(readonly page: Page) {
    this.chrome = new AdminFormChrome(page);
    this.parent = page.getByRole('combobox', { name: 'Parent Id' });
    const body = page.locator('body');
    this.name = new FormField(body, 'Name');
    this.slug = new FormField(body, 'Slug');
  }

  @step('Fill in category "{0.name}"')
  async fillIn(category: CategoryInput): Promise<void> {
    if (category.parent) await this.parent.selectOption({ label: category.parent });
    await this.name.input.fill(category.name);
    await this.slug.input.fill(category.slug);
  }
}

export interface ProductInput {
  name: string;
  description: string;
  /** Left out for a rental: ticking "Item for rent" clears the stock, so a value typed first would be dead data. */
  stock?: string;
  price: string;
  co2Rating?: string;
  brand?: string;
  category?: string;
  image?: string;
  /** Tick "Item for rent": the shop's default list, categories and filters leave rentals out. */
  rental?: boolean;
  /** Tick "Location offer". */
  locationOffer?: boolean;
}

export class AdminProductForm {
  readonly chrome: AdminFormChrome;
  readonly name: Locator;
  readonly description: Locator;
  readonly stock: Locator;
  readonly price: Locator;
  readonly locationOffer: Locator;
  readonly rental: Locator;
  readonly co2Rating: Locator;
  readonly brand: Locator;
  readonly category: Locator;
  readonly image: Locator;
  readonly specRows: Locator;
  readonly newSpecName: Locator;
  readonly newSpecValue: Locator;
  readonly newSpecUnit: Locator;
  readonly addSpecButton: Locator;

  constructor(readonly page: Page) {
    this.chrome = new AdminFormChrome(page);
    this.name = page.getByRole('textbox', { name: 'Name', exact: true });
    this.description = page.getByRole('textbox', { name: 'Description' });
    this.stock = page.getByRole('textbox', { name: 'Stock', exact: true });
    this.price = page.getByRole('textbox', { name: 'Price', exact: true });
    this.locationOffer = page.getByRole('checkbox', { name: 'Location offer' });
    this.rental = page.getByRole('checkbox', { name: 'Item for rent' });
    this.co2Rating = page.getByRole('combobox', { name: 'CO₂ Rating' });
    this.brand = page.getByRole('combobox', { name: 'Brand' });
    this.category = page.getByRole('combobox', { name: 'Category' });
    this.image = page.getByRole('combobox', { name: 'Image' });
    this.specRows = page.getByTestId('specs-table').getByRole('row').filter({ has: page.getByRole('button', { name: '×' }) });
    // The "new spec" inputs have no labels (only placeholders), so their test ids are used.
    this.newSpecName = page.getByTestId('spec-name');
    this.newSpecValue = page.getByTestId('spec-value');
    this.newSpecUnit = page.getByTestId('spec-unit');
    this.addSpecButton = page.getByTestId('add-spec');
  }

  @step('Fill in product "{0.name}"')
  async fillIn(product: ProductInput): Promise<void> {
    await this.name.fill(product.name);
    await this.description.fill(product.description);
    if (product.stock !== undefined) await this.stock.fill(product.stock);
    await this.price.fill(product.price);
    if (product.rental) await this.rental.check();
    if (product.co2Rating) await this.co2Rating.selectOption({ label: product.co2Rating });
    if (product.locationOffer) await this.locationOffer.check();
    // Brand, category and image default to the first real record unless named.
    await this.brand.selectOption(product.brand ? { label: product.brand } : { index: FIRST_RECORD });
    await this.category.selectOption(product.category ? { label: product.category } : { index: FIRST_RECORD });
    await this.image.selectOption(product.image ? { label: product.image } : { index: FIRST_RECORD });
  }

  /** The first real brand, category and image, for a form that did not preselect them (ADM-09). */
  @step('Choose a brand, category and image')
  async chooseRelations(): Promise<void> {
    await this.brand.selectOption({ index: FIRST_RECORD });
    await this.category.selectOption({ index: FIRST_RECORD });
    await this.image.selectOption({ index: FIRST_RECORD });
  }

  @step('Add spec {0}: {1}')
  async addSpec(name: string, value: string, unit = ''): Promise<void> {
    await this.newSpecName.fill(name);
    await this.newSpecValue.fill(value);
    await this.newSpecUnit.fill(unit);
    await this.addSpecButton.click();
  }

  @step('Remove spec "{0}"')
  async removeSpec(name: string): Promise<void> {
    await this.specRows.filter({ hasText: name }).getByRole('button', { name: '×' }).click();
  }
}

export interface UserInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  street: string;
  city: string;
  country: string;
  email: string;
  /** Optional on the form: Postal code, State, Phone and Password may stay empty. */
  postalCode?: string;
  state?: string;
  phone?: string;
  password?: string;
}

export class AdminUserForm {
  readonly chrome: AdminFormChrome;
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly dateOfBirth: Locator;
  readonly street: Locator;
  readonly postalCode: Locator;
  readonly city: Locator;
  readonly state: Locator;
  readonly country: Locator;
  readonly phone: Locator;
  readonly email: Locator;
  readonly enabled: Locator;
  readonly failedLoginAttempts: Locator;
  readonly password: Locator;

  constructor(readonly page: Page) {
    this.chrome = new AdminFormChrome(page);
    this.firstName = page.getByRole('textbox', { name: 'First Name' });
    this.lastName = page.getByRole('textbox', { name: 'Last Name' });
    this.dateOfBirth = page.getByRole('textbox', { name: 'Date of birth' });
    this.street = page.getByRole('textbox', { name: 'Street', exact: true });
    this.postalCode = page.getByRole('textbox', { name: 'Postal code' });
    this.city = page.getByRole('textbox', { name: 'City', exact: true });
    this.state = page.getByRole('textbox', { name: 'State', exact: true });
    this.country = page.getByRole('combobox', { name: 'Country' });
    this.phone = page.getByRole('textbox', { name: 'Phone', exact: true });
    this.email = page.getByRole('textbox', { name: 'Email', exact: true });
    this.enabled = page.getByRole('checkbox', { name: 'Enabled' });
    this.failedLoginAttempts = page.getByRole('textbox', { name: 'Failed login attempts' });
    // By label, not role: a password field is not a textbox, and the form's is (ADM-17), so a role locator would stop finding it the day that is fixed.
    this.password = page.getByLabel('Password', { exact: true });
  }

  @step('Fill in user {0.email}')
  async fillIn(user: UserInput): Promise<void> {
    await this.firstName.fill(user.firstName);
    await this.lastName.fill(user.lastName);
    await this.dateOfBirth.fill(user.dateOfBirth);
    await this.street.fill(user.street);
    if (user.postalCode) await this.postalCode.fill(user.postalCode);
    await this.city.fill(user.city);
    if (user.state) await this.state.fill(user.state);
    await this.country.selectOption(user.country);
    if (user.phone) await this.phone.fill(user.phone);
    await this.email.fill(user.email);
    if (user.password) await this.password.fill(user.password);
  }
}
