import type { Page } from '@playwright/test';
import { AdminBrandForm, AdminCategoryForm, AdminProductForm, AdminUserForm } from './AdminForms';
import { AdminMessagePage } from './AdminMessagePage';
import { AdminOrderPage } from './AdminOrderPage';

/** The six back-office lists: where each lives, what feeds its table, and the page its Add / Edit / Details leads to. */
export const ADMIN_LISTS = {
  products: { path: '/admin/products', heading: 'Products', feed: { method: 'QUERY', path: /^\/products$/ }, searchLabel: 'Search products', addLink: 'Add Product', detail: (p: Page) => new AdminProductForm(p) },
  brands: { path: '/admin/brands', heading: 'Brands', feed: { method: 'GET', path: /^\/brands$/ }, searchLabel: 'Search brands', addLink: 'Add Brand', detail: (p: Page) => new AdminBrandForm(p) },
  categories: { path: '/admin/categories', heading: 'Categories', feed: { method: 'GET', path: /^\/categories$/ }, searchLabel: 'Search categories', addLink: 'Add Category', detail: (p: Page) => new AdminCategoryForm(p) },
  orders: { path: '/admin/orders', heading: 'Order', feed: { method: 'GET', path: /^\/invoices$/ }, searchLabel: 'Search orders', detail: (p: Page) => new AdminOrderPage(p) },
  users: { path: '/admin/users', heading: 'Users', feed: { method: 'GET', path: /^\/users$/ }, searchLabel: 'Search users', addLink: 'Add User', detail: (p: Page) => new AdminUserForm(p) },
  messages: { path: '/admin/messages', heading: 'Messages', feed: { method: 'GET', path: /^\/messages$/ }, detail: (p: Page) => new AdminMessagePage(p) },
} as const;

export type AdminListName = keyof typeof ADMIN_LISTS;
