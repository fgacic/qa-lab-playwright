import type { Locator } from '@playwright/test';

/**
 * A labelled input with its validation label. Toolshop renders each error under the field
 * with `data-test="<field>-error"`, which is the one place a test id is the clearest locator.
 */
export class FormField {
  readonly input: Locator;
  readonly error: Locator;

  constructor(scope: Locator, label: string | RegExp, errorTestId?: string) {
    this.input = scope.getByLabel(label, { exact: typeof label === 'string' });
    this.error = scope.getByTestId(errorTestId ?? 'no-error-label-for-this-field');
  }
}
