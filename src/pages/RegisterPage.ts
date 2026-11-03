import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { settleRequests } from '@support/settle';
import { step } from '@support/step';
import type { Customer } from '@support/test-data';
import { AppShell } from './AppShell';
import { LoginPage } from './LoginPage';

export class RegisterPage {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly firstName: FormField;
  readonly lastName: FormField;
  readonly dateOfBirth: FormField;
  readonly country: FormField;
  readonly postalCode: FormField;
  readonly houseNumber: FormField;
  readonly street: FormField;
  readonly city: FormField;
  readonly state: FormField;
  readonly phone: FormField;
  readonly email: FormField;
  readonly password: FormField;
  readonly showPasswordButton: Locator;
  readonly passwordRules: Locator;
  readonly registerButton: Locator;
  readonly error: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    const form = page.getByTestId('register-form');
    this.heading = page.getByRole('heading', { name: 'Customer registration' });
    this.firstName = new FormField(form, 'First name', 'first-name-error');
    this.lastName = new FormField(form, 'Last name', 'last-name-error');
    this.dateOfBirth = new FormField(form, 'Date of Birth *', 'dob-error');
    this.country = new FormField(form, 'Country', 'country-error');
    this.postalCode = new FormField(form, 'Postal code', 'postal_code-error');
    this.houseNumber = new FormField(form, 'House number', 'house_number-error');
    this.street = new FormField(form, 'Street', 'street-error');
    this.city = new FormField(form, 'City', 'city-error');
    this.state = new FormField(form, 'State', 'state-error');
    this.phone = new FormField(form, 'Phone', 'phone-error');
    this.email = new FormField(form, 'Email address', 'email-error');
    this.password = new FormField(form, 'Password', 'password-error');
    this.showPasswordButton = form.getByRole('button', { name: '', exact: true });
    this.passwordRules = form.getByRole('listitem');
    this.registerButton = form.getByRole('button', { name: 'Register' });
    this.error = page.getByTestId('register-error');
  }

  /** Every field with its validation label, in form order. */
  get fields() {
    return {
      'First name': this.firstName, 'Last name': this.lastName, 'Date of birth': this.dateOfBirth,
      Country: this.country, 'Postal code': this.postalCode, 'House number': this.houseNumber,
      Street: this.street, City: this.city, State: this.state, Phone: this.phone,
      Email: this.email, Password: this.password,
    };
  }

  @step('Open the registration page')
  async open(): Promise<void> {
    await this.shell.goto('/auth/register');
  }

  /**
   * The postcode lookup fires as soon as country, postcode and house number are set and
   * overwrites street, city and state, so those three are typed after it has answered.
   */
  @step('Fill in the registration form for {0.email}')
  async fillIn(customer: Customer): Promise<void> {
    await this.firstName.input.fill(customer.firstName);
    await this.lastName.input.fill(customer.lastName);
    await this.dateOfBirth.input.fill(customer.dateOfBirth);
    await settleRequests(this.page, '/postcode-lookup', async () => {
      await this.country.input.selectOption(customer.address.country);
      await this.postalCode.input.fill(customer.address.postalCode);
      await this.houseNumber.input.fill(customer.address.houseNumber);
    });
    await this.street.input.fill(customer.address.street);
    await this.city.input.fill(customer.address.city);
    await this.state.input.fill(customer.address.state);
    await this.phone.input.fill(customer.phone);
    await this.email.input.fill(customer.email);
    await this.password.input.fill(customer.password);
  }

  /** Returns the login page, where a successful registration sends the new customer. */
  @step('Register {0.email}')
  async register(customer: Customer): Promise<LoginPage> {
    await this.fillIn(customer);
    await this.submit();
    return new LoginPage(this.page);
  }

  @step('Submit the registration form')
  async submit(): Promise<void> {
    await this.registerButton.click();
  }
}
