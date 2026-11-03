import type { Locator, Page } from '@playwright/test';

/** Toastr notifications: each one is an ARIA alert that disappears after about five seconds. */
export class Toast {
  constructor(private readonly page: Page) {}

  message(text: string | RegExp): Locator {
    return this.page.getByRole('alert').filter({ hasText: text });
  }
}
