/**
 * Accessibility violations the site has today, from a full axe scan (WCAG 2.2 A + AA) of every
 * page in tests/a11y/pages.a11y.spec.ts. One entry per rule on one kind of element (axe's CSS
 * target with nth-child indices removed). Each is pinned by its own knownBug test in
 * known-violations.a11y.spec.ts. Rebuild with: A11Y_RECORD=/tmp/findings.jsonl npm run test:a11y
 */
export interface KnownViolation {
  id: string;
  rule: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  /** WCAG success criterion. */
  wcag: string;
  target: string;
  /** Where its pin test scans (one of the pages it occurs on). */
  page: 'checkout sign-in' | 'login' | 'register' | 'account profile' | 'admin messages' | 'chat open' | 'home' | 'cart' | 'product';
  summary: string;
}

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  { id: 'AX-01', rule: 'aria-required-children', impact: 'critical', wcag: '1.3.1', target: '.nav', page: 'checkout sign-in', summary: 'The sign-in / guest tab list (role tablist) contains list items instead of tabs.' },
  { id: 'AX-02', rule: 'aria-required-parent', impact: 'critical', wcag: '1.3.1', target: 'a[href$="#signin-tab"]', page: 'checkout sign-in', summary: 'The "Sign in" tab is not directly inside its tablist.' },
  { id: 'AX-03', rule: 'aria-required-parent', impact: 'critical', wcag: '1.3.1', target: 'a[href$="#guest-tab"]', page: 'checkout sign-in', summary: 'The "Continue as Guest" tab is not directly inside its tablist.' },
  { id: 'AX-04', rule: 'button-name', impact: 'critical', wcag: '4.1.2', target: '.btn-outline-secondary', page: 'login', summary: 'The show-password button has no accessible name (login, register; see A11Y-02).' },
  { id: 'AX-05', rule: 'button-name', impact: 'critical', wcag: '4.1.2', target: 'app-password-input[formcontrolname="new_password"] > .input-group > .input-group-append > .btn-outline-secondary.btn[type="button"]', page: 'account profile', summary: 'The show-password button of "New Password" has no accessible name.' },
  { id: 'AX-06', rule: 'button-name', impact: 'critical', wcag: '4.1.2', target: 'app-password-input[formcontrolname="new_password_confirmation"] > .input-group > .input-group-append > .btn-outline-secondary.btn[type="button"]', page: 'account profile', summary: 'The show-password button of "Confirm New Password" has no accessible name.' },
  { id: 'AX-07', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: '.badge', page: 'admin messages', summary: 'Status badges in the admin inbox have too little contrast.' },
  { id: 'AX-08', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: '.chat-title', page: 'chat open', summary: 'The chat title has too little contrast.' },
  { id: 'AX-09', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: '.message-content', page: 'chat open', summary: 'Chat messages have too little contrast.' },
  { id: 'AX-10', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: 'button[data-test="chat-action-find-product"]', page: 'chat open', summary: 'The chat "Find a product" button has too little contrast.' },
  { id: 'AX-11', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: 'button[data-test="chat-action-order-product"]', page: 'chat open', summary: 'The chat "Order a product" button has too little contrast.' },
  { id: 'AX-12', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: 'button[data-test="chat-action-start-checkout"]', page: 'chat open', summary: 'The chat "Checkout" button has too little contrast.' },
  { id: 'AX-13', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: 'button[data-test="chat-action-support-ticket"]', page: 'chat open', summary: 'The chat "Create support ticket" button has too little contrast.' },
  { id: 'AX-14', rule: 'label-content-name-mismatch', impact: 'serious', wcag: '2.5.3', target: '#language', page: 'home', summary: 'The language button shows "EN" but is named "Select language", so voice control by its label fails (every page).' },
  { id: 'AX-15', rule: 'label-content-name-mismatch', impact: 'serious', wcag: '2.5.3', target: 'a[data-test="nav-cart"]', page: 'cart', summary: 'The cart link shows the item count but its name does not contain it.' },
  { id: 'AX-16', rule: 'list', impact: 'serious', wcag: '1.3.1', target: '#passwordHelp > ul', page: 'register', summary: 'The password rules list contains a non-list element.' },
  { id: 'AX-17', rule: 'list', impact: 'serious', wcag: '1.3.1', target: '.checkbox > ul', page: 'home', summary: 'The subcategory lists in the filters contain groups instead of list items.' },
  { id: 'AX-18', rule: 'listitem', impact: 'serious', wcag: '1.3.1', target: '.nav > .nav-item', page: 'checkout sign-in', summary: 'The tab list items are not inside a list (role overridden to tablist).' },
  { id: 'AX-19', rule: 'target-size', impact: 'serious', wcag: '2.5.8', target: '.card > .card-body > a[href="#"][large=""]', page: 'product', summary: 'The "More information" links of related products are smaller than 24×24 px and too close together.' },
];
