import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';

/**
 * What every back-office form shares: heading, Id, Save, Back, and the alerts that carry both
 * validation labels and "… saved!" messages. Each form holds one (composition, no base class).
 */
export class AdminFormChrome {
  readonly heading: Locator;
  readonly id: Locator;
  readonly saveButton: Locator;
  readonly backLink: Locator;
  /** Validation labels and the "… saved!" / error messages are all ARIA alerts. */
  readonly alerts: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 2 });
    this.id = page.getByRole('textbox', { name: 'Id', exact: true });
    this.saveButton = page.getByRole('button', { name: 'Save' });
    this.backLink = page.getByRole('link', { name: 'Back' });
    this.alerts = page.getByRole('alert');
  }

  alert(text: string | RegExp): Locator {
    return this.alerts.filter({ hasText: text });
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
  readonly name: Locator;
  readonly slug: Locator;

  constructor(readonly page: Page) {
    this.chrome = new AdminFormChrome(page);
    this.parent = page.getByRole('combobox', { name: 'Parent Id' });
    this.name = page.getByRole('textbox', { name: 'Name', exact: true });
    this.slug = page.getByRole('textbox', { name: 'Slug', exact: true });
  }

  @step('Fill in category "{0.name}"')
  async fillIn(category: CategoryInput): Promise<void> {
    if (category.parent) await this.parent.selectOption({ label: category.parent });
    await this.name.fill(category.name);
    await this.slug.fill(category.slug);
  }
}

export interface ProductInput {
  name: string;
  description: string;
  stock: string;
  price: string;
  co2Rating?: string;
  brand?: string;
  category?: string;
  image?: string;
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
    this.stock = page.getByRole('textbox', { name: 'Stock' });
    this.price = page.getByRole('textbox', { name: 'Price' });
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
    await this.stock.fill(product.stock);
    await this.price.fill(product.price);
    if (product.co2Rating) await this.co2Rating.selectOption({ label: product.co2Rating });
    // Brand, category and image default to the first real option unless named.
    await this.brand.selectOption(product.brand ? { label: product.brand } : { index: 1 });
    await this.category.selectOption(product.category ? { label: product.category } : { index: 1 });
    await this.image.selectOption(product.image ? { label: product.image } : { index: 1 });
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
  postalCode: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  email: string;
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
    this.street = page.getByRole('textbox', { name: 'Street' });
    this.postalCode = page.getByRole('textbox', { name: 'Postal code' });
    this.city = page.getByRole('textbox', { name: 'City' });
    this.state = page.getByRole('textbox', { name: 'State' });
    this.country = page.getByRole('combobox', { name: 'Country' });
    this.phone = page.getByRole('textbox', { name: 'Phone' });
    this.email = page.getByRole('textbox', { name: 'Email' });
    this.enabled = page.getByRole('checkbox', { name: 'Enabled' });
    this.failedLoginAttempts = page.getByRole('textbox', { name: 'Failed login attempts' });
    this.password = page.getByRole('textbox', { name: 'Password' });
  }

  @step('Fill in user {0.email}')
  async fillIn(user: UserInput): Promise<void> {
    await this.firstName.fill(user.firstName);
    await this.lastName.fill(user.lastName);
    await this.dateOfBirth.fill(user.dateOfBirth);
    await this.street.fill(user.street);
    await this.postalCode.fill(user.postalCode);
    await this.city.fill(user.city);
    await this.state.fill(user.state);
    await this.country.selectOption(user.country);
    await this.phone.fill(user.phone);
    await this.email.fill(user.email);
    if (user.password) await this.password.fill(user.password);
  }
}
