/**
 * Accessibility violations the site has today, from a full axe scan (WCAG 2.2 A + AA) of every
 * page in tests/a11y/pages.a11y.spec.ts. One entry per rule on one kind of element (axe's CSS
 * target with nth-child indices removed). Each is pinned by its own knownBug test in
 * known-violations.a11y.spec.ts. A violation is known only on the pages it was recorded on (`pages`,
 * the scan names in pages.a11y.spec.ts) and for as many elements as it was recorded with (`nodes`),
 * so the same selector on another page, or the defect spreading, is a new violation.
 * Rebuild from a real run (refuses to run on CI):
 *   A11Y_RECORD=/tmp/findings.jsonl npx playwright test tests/a11y/pages.a11y.spec.ts --project=chromium
 * then fill `pages` and `nodes` from the JSON lines (page, rule, target, nodes).
 */
/**
 * Every state tests/a11y/pages.a11y.spec.ts scans, by the name the baseline, the scan's attachment
 * and a pin all use. One list, so a typo in `pages` or in a scan is a compile error, not a violation
 * that is "known" nowhere.
 */
export const SCAN_NAMES = [
  'home', 'search results', 'search without results', 'product', 'product out of stock', 'category', 'rentals',
  'comparison', 'cart', 'checkout sign-in', 'checkout guest with errors', 'login with errors',
  'checkout billing', 'register with errors', 'forgot password', 'checkout payment', 'contact with errors',
  'privacy policy', 'chat open', 'unknown route', 'account', 'account favorites', 'account invoices',
  'account messages', 'account profile', 'admin dashboard', 'admin products', 'admin product form',
  'admin brands', 'admin brand form', 'admin categories', 'admin orders', 'admin users', 'admin order',
  'admin user form', 'admin messages', 'admin statistics', 'admin message', 'admin sales report',
  'admin settings',
] as const;
export type ScanName = (typeof SCAN_NAMES)[number];

export interface KnownViolation {
  id: string;
  rule: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  /** WCAG success criterion. */
  wcag: string;
  target: string;
  /** The scans (names in pages.a11y.spec.ts) it was recorded on. */
  pages: ScanName[];
  /** The most elements of this kind it was recorded on in one scan. */
  nodes: number;
  /**
   * The count follows the shop's seed data (how many categories have subcategories, how many
   * products are related), which the self-hosted shop fixes and the shared live site does not: it
   * is compared exactly only on the self-hosted target. Elsewhere the violation must still be found where it was
   * recorded and nowhere else, but its element count is not held to the self-hosted one.
   */
  seedDependent?: true;
  /** Where its pin test scans (one of the pages it occurs on). */
  page: 'checkout sign-in' | 'login' | 'register' | 'account profile' | 'admin messages' | 'home' | 'cart' | 'product';
  summary: string;
}

/** The scans the language button, present in the header of every page, is recorded on. */
const EVERY_PAGE: ScanName[] = [...SCAN_NAMES];

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  { id: 'AX-01', rule: 'aria-required-children', impact: 'critical', wcag: '1.3.1', target: '.nav', pages: ['checkout sign-in'], nodes: 1, page: 'checkout sign-in', summary: 'The sign-in / guest tab list (role tablist) contains list items instead of tabs.' },
  { id: 'AX-02', rule: 'aria-required-parent', impact: 'critical', wcag: '1.3.1', target: 'a[href$="#signin-tab"]', pages: ['checkout sign-in'], nodes: 1, page: 'checkout sign-in', summary: 'The "Sign in" tab is not directly inside its tablist.' },
  { id: 'AX-03', rule: 'aria-required-parent', impact: 'critical', wcag: '1.3.1', target: 'a[href$="#guest-tab"]', pages: ['checkout sign-in'], nodes: 1, page: 'checkout sign-in', summary: 'The "Continue as Guest" tab is not directly inside its tablist.' },
  { id: 'AX-04', rule: 'button-name', impact: 'critical', wcag: '4.1.2', target: '.btn-outline-secondary', pages: ['login with errors', 'register with errors'], nodes: 1, page: 'login', summary: 'The show-password button has no accessible name (login, register; see A11Y-02).' },
  { id: 'AX-05', rule: 'button-name', impact: 'critical', wcag: '4.1.2', target: 'app-password-input[formcontrolname="new_password"] > .input-group > .input-group-append > .btn-outline-secondary.btn[type="button"]', pages: ['account profile'], nodes: 1, page: 'account profile', summary: 'The show-password button of "New Password" has no accessible name.' },
  { id: 'AX-06', rule: 'button-name', impact: 'critical', wcag: '4.1.2', target: 'app-password-input[formcontrolname="new_password_confirmation"] > .input-group > .input-group-append > .btn-outline-secondary.btn[type="button"]', pages: ['account profile'], nodes: 1, page: 'account profile', summary: 'The show-password button of "Confirm New Password" has no accessible name.' },
  { id: 'AX-07', rule: 'color-contrast', impact: 'serious', wcag: '1.4.3', target: '.badge', pages: ['admin messages', 'admin message'], nodes: 1, page: 'admin messages', summary: 'Status badges in the admin inbox have too little contrast.' },
  { id: 'AX-08', rule: 'label-content-name-mismatch', impact: 'serious', wcag: '2.5.3', target: '#language', pages: EVERY_PAGE, nodes: 1, page: 'home', summary: 'The language button shows "EN" but is named "Select language", so voice control by its label fails (every page).' },
  { id: 'AX-09', rule: 'label-content-name-mismatch', impact: 'serious', wcag: '2.5.3', target: 'a[data-test="nav-cart"]', pages: ['cart', 'checkout sign-in', 'checkout guest with errors', 'checkout billing', 'checkout payment'], nodes: 1, page: 'cart', summary: 'The cart link shows the item count but its name does not contain it.' },
  { id: 'AX-10', rule: 'list', impact: 'serious', wcag: '1.3.1', target: '#passwordHelp > ul', pages: ['register with errors', 'account profile'], nodes: 1, page: 'register', summary: 'The password rules list contains a non-list element.' },
  { id: 'AX-11', rule: 'list', impact: 'serious', wcag: '1.3.1', target: '.checkbox > ul', pages: ['home', 'search results', 'search without results', 'chat open'], nodes: 3, seedDependent: true, page: 'home', summary: 'The subcategory lists in the filters contain groups instead of list items.' },
  { id: 'AX-12', rule: 'listitem', impact: 'serious', wcag: '1.3.1', target: '.nav > .nav-item', pages: ['checkout sign-in'], nodes: 2, page: 'checkout sign-in', summary: 'The tab list items are not inside a list (role overridden to tablist).' },
  { id: 'AX-13', rule: 'target-size', impact: 'serious', wcag: '2.5.8', target: '.card > .card-body > a[href="#"][large=""]', pages: ['product', 'product out of stock'], nodes: 4, seedDependent: true, page: 'product', summary: 'The "More information" links of related products are smaller than 24×24 px and too close together.' },
];
