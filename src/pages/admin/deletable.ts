import { brand, category, customer, product } from '@support/admin-payloads';
import { ADMIN_MESSAGES } from './alerts';
import type { AdminListName } from './admin-lists';

/** What one entity of a deletable list is called in the messages the back office shows. */
type DeletedEntity = 'product' | 'brand' | 'category' | 'user';

export interface Deletable {
  list: Extract<AdminListName, 'products' | 'brands' | 'categories' | 'users'>;
  entity: DeletedEntity;
  /** Text that picks the mocked record's row in the list. */
  row: string;
  /** The endpoint a delete of the mocked record calls, and any record's (for a mock that refuses every delete). */
  path: string;
  anyRecord: RegExp;
}

/** The four lists with a Delete button: the mocked record each serves, and the endpoint its delete calls. */
export const DELETABLE: readonly Deletable[] = [
  { list: 'products', entity: 'product', row: product.id, path: `/products/${product.id}`, anyRecord: /^\/products\/[^/]+$/ },
  { list: 'brands', entity: 'brand', row: brand.name, path: `/brands/${brand.id}`, anyRecord: /^\/brands\/[^/]+$/ },
  { list: 'categories', entity: 'category', row: category.name, path: `/categories/${category.id}`, anyRecord: /^\/categories\/[^/]+$/ },
  { list: 'users', entity: 'user', row: customer.email, path: `/users/${customer.id}`, anyRecord: /^\/users\/[^/]+$/ },
];

/** The confirmation the back office shows once the entity is deleted ("Brand deleted."). */
export const deletedMessage = (entity: DeletedEntity): string => ADMIN_MESSAGES[`${entity}Deleted` as const];
