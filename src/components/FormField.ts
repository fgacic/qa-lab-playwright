import type { Locator } from '@playwright/test';

/**
 * A labelled input with its validation label. Toolshop renders each error under the field
 * with `data-test="<field>-error"`, which is the one place a test id is the clearest locator.
 * A field built without that id has no `error`: reading it throws, instead of pointing at an
 * element that does not exist and letting a spec wait on it.
 */
/**
 * What the shop's forms say under a field, word for word. The wording is the shop's (typed once here, so a changed message is
 * one edit and not one per spec): the sign-in, registration, contact and chat tests read these.
 */
export const FIELD_ERRORS = {
  required: (field: string) => `${field} is required`,
  emailInvalid: 'Email format is invalid',
  passwordRules: 'Password must be minimal 6 characters long. Password can not include invalid characters.',
} as const;

export class FormField {
  readonly input: Locator;
  private readonly errorLocator?: Locator;

  constructor(scope: Locator, private readonly label: string | RegExp, errorTestId?: string) {
    this.input = scope.getByLabel(label, { exact: typeof label === 'string' });
    this.errorLocator = errorTestId ? scope.getByTestId(errorTestId) : undefined;
  }

  get error(): Locator {
    if (!this.errorLocator) throw new Error(`The "${this.label}" field was built without an error test id, so it has no error label to read.`);
    return this.errorLocator;
  }
}
