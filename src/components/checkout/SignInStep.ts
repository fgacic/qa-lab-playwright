import type { Locator } from '@playwright/test';
import { step } from '@support/step';
import type { Person } from '@support/test-data';
import { FormField } from '../FormField';

/** Step 2: a "Sign in" tab and a "Continue as Guest" tab. */
export class SignInStep {
  readonly signInTab: Locator;
  readonly guestTab: Locator;
  readonly email: FormField;
  readonly password: FormField;
  readonly loginButton: Locator;
  readonly loginError: Locator;
  readonly guestEmail: FormField;
  readonly guestFirstName: FormField;
  readonly guestLastName: FormField;
  readonly continueAsGuestButton: Locator;
  readonly guestSummary: Locator;
  readonly proceedAsGuestButton: Locator;
  /** Shown instead of the tabs when the customer is already signed in. */
  readonly proceedSignedInButton: Locator;

  constructor(root: Locator) {
    this.signInTab = root.getByRole('tab', { name: 'Sign in' });
    this.guestTab = root.getByRole('tab', { name: 'Continue as Guest' });
    const signIn = root.getByRole('tabpanel').filter({ has: root.page().getByRole('heading', { name: 'Login' }) });
    const guest = root.getByRole('tabpanel').filter({ has: root.page().getByRole('heading', { name: 'Continue as Guest' }) });
    this.email = new FormField(signIn, 'Email address *', 'email-error');
    this.password = new FormField(signIn, 'Password *', 'password-error');
    this.loginButton = signIn.getByRole('button', { name: 'Login' });
    this.loginError = signIn.getByTestId('login-error');
    this.guestEmail = new FormField(guest, 'Email address *', 'guest-email-error');
    this.guestFirstName = new FormField(guest, 'First name *', 'guest-first-name-error');
    this.guestLastName = new FormField(guest, 'Last name *', 'guest-last-name-error');
    this.continueAsGuestButton = guest.getByRole('button', { name: 'Continue as Guest' });
    this.guestSummary = root.getByText(/^Continuing as guest:/);
    this.proceedAsGuestButton = root.getByTestId('proceed-2-guest');
    this.proceedSignedInButton = root.getByTestId('proceed-2');
  }

  @step('Sign in at checkout as {0}')
  async signIn(email: string, password: string): Promise<void> {
    await this.signInTab.click();
    await this.email.input.fill(email);
    await this.password.input.fill(password);
    await this.loginButton.click();
  }

  @step('Enter guest details for {0.email}')
  async enterGuestDetails(guest: Person): Promise<void> {
    await this.guestTab.click();
    await this.guestEmail.input.fill(guest.email);
    await this.guestFirstName.input.fill(guest.firstName);
    await this.guestLastName.input.fill(guest.lastName);
    await this.continueAsGuestButton.click();
  }

  @step('Continue as guest {0.email}')
  async continueAsGuest(guest: Person): Promise<void> {
    await this.enterGuestDetails(guest);
    await this.proceedAsGuestButton.click();
  }
}
