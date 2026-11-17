import type { AdminSection } from '@components/Header';

/** The heading each back-office section opens on (the dashboard has none of its own; the orders list says "Order"). */
export const SECTION_HEADINGS: Record<AdminSection, string> = {
  Dashboard: 'Sales over the years',
  Brands: 'Brands',
  Categories: 'Categories',
  Products: 'Products',
  Orders: 'Order',
  Users: 'Users',
  Messages: 'Messages',
  Settings: 'Settings',
};

/** The address each back-office section opens on, stated once, so a section whose path stops following its name fails under its own name. */
export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
  Dashboard: '/admin/dashboard',
  Brands: '/admin/brands',
  Categories: '/admin/categories',
  Products: '/admin/products',
  Orders: '/admin/orders',
  Users: '/admin/users',
  Messages: '/admin/messages',
  Settings: '/admin/settings',
};

/** Every other address of the back office: the reports, the pages that add a record, and the ones that edit or show one (any id will do for a visitor who is turned away). */
const OTHER_ADMIN_ADDRESSES = [
  '/admin/reports/statistics',
  '/admin/reports/average-sales-per-month',
  '/admin/reports/average-sales-per-week',
  '/admin/products/add',
  '/admin/brands/add',
  '/admin/categories/add',
  '/admin/users/add',
  '/admin/products/edit/qalab',
  '/admin/brands/edit/qalab',
  '/admin/categories/edit/qalab',
  '/admin/users/edit/qalab',
  '/admin/orders/edit/qalab',
  '/admin/messages/qalab',
] as const;

/** Every address of the back office a visitor could type: the eight sections and `OTHER_ADMIN_ADDRESSES`. */
export const ADMIN_ADDRESSES: readonly string[] = [...Object.values(ADMIN_SECTION_PATHS), ...OTHER_ADMIN_ADDRESSES];
