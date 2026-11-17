import { mergeTests } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, newCustomer, REFUSED_OR_HIDDEN, removeLater } from '@support/authz';
import { knownBug } from '@support/known-bug';

/**
 * Whose cart is it: the cart's id is the only thing that names a cart, so it is the whole question whether another caller who holds
 * that id may read it, add to it and delete it. A guest has no account, so a cart cannot demand a token from everybody; but a cart a
 * signed-in customer made has an owner, and the same id in the hands of another customer (or of nobody) is the case an
 * insecure direct object reference check looks at. Like the other authorisation specs these are plain HTTP calls on the self-hosted
 * Toolshop (@self-hosted), tagged @api so they run once; the carts they make are removed again through the admin's token, pass or fail.
 *
 * What the API does today: an id that was never issued is a 404 for everybody (the control), the ids are 26 random characters (not a
 * counter to walk through), and the cart answers whoever presents its id, with no token at all (SEC-15 pins that for a signed-in owner).
 */
const test = mergeTests(apiOnlyTest, worldTest);

/** The shape of a cart answer this file reads. */
interface Cart {
  id: string;
  cart_items: { product: { id: string }; quantity: number }[];
}

/** The shape of a cart id (a ULID, lower-cased): 26 characters of digits and letters. */
const CART_ID = /^[0-9a-z]{26}$/;
/** An id of that shape that was never issued. */
const UNISSUED_CART_ID = '01zzzzzzzzzzzzzzzzzzzzzzzz';

test.describe('API authorisation, carts (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  test('a cart id that was never issued is answered 404, to an anonymous caller and to a customer', async ({ request, api, adminToken, cleanups }) => {
    // Made up from the id's alphabet: the answer is about the id, not the shape of the path.
    const unissued = UNISSUED_CART_ID;
    const { token } = await newCustomer({ request, api, adminToken, cleanups });

    const anonymous = await call(request, 'GET', `/carts/${unissued}`);
    const customer = await call(request, 'GET', `/carts/${unissued}`, { token });

    expect([anonymous.status(), customer.status()], 'GET /carts/{id} of an id nobody was given, as an anonymous caller and as a customer').toEqual([404, 404]);
  });

  test('cart ids are not a counter: the random part of each of five new carts is different', async ({ request, world }) => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await call(request, 'POST', '/carts', { data: {} });
      expect(response.status(), 'POST /carts answered').toBe(201);
      const { id } = (await response.json()) as { id: string };
      removeLater(world, `/carts/${id}`);
      ids.push(id);
    }

    expect(ids.every((id) => CART_ID.test(id)), `every id is 26 lower-case letters and digits (${ids.join(', ')})`).toBe(true);
    // A ULID: 10 characters of time, then 16 random ones. Carts made within a millisecond or two share the time, never the rest.
    expect(new Set(ids.map((id) => id.slice(10))).size, 'the 16 trailing characters of the five ids are all different').toBe(5);
  });

  test.describe("another caller's cart", { tag: ['@bug'] }, () => {
    test("the cart of a signed-in customer cannot be read, added to or deleted by somebody else's token", async ({ request, catalog, world }) => {
      knownBug('SEC-15', "a cart a signed-in customer made answers anybody who has its id: another customer, or no token at all, can read it, add a line to it and delete it.");
      const product = await catalog.inStock();
      const owner = await newCustomer(world);
      const intruder = await newCustomer(world);
      const made = await call(request, 'POST', '/carts', { token: owner.token, data: {} });
      expect(made.status(), 'the owner made a cart').toBe(201);
      const { id } = (await made.json()) as { id: string };
      removeLater(world, `/carts/${id}`);
      expect((await call(request, 'POST', `/carts/${id}`, { token: owner.token, data: { product_id: product.id, quantity: 1 } })).status(), 'the owner added a line').toBe(200);
      // Precondition, true whether or not the bug is fixed: the owner reads their own cart with its one line, so a 404 for the intruder is a hiding and not a wrong path.
      const own = await call(request, 'GET', `/carts/${id}`, { token: owner.token });
      expect(own.status(), 'the owner reads their own cart').toBe(200);
      expect(((await own.json()) as Cart).cart_items.map((item) => item.product.id), 'the owner has the one line they added').toEqual([product.id]);

      const read = await call(request, 'GET', `/carts/${id}`, { token: intruder.token });
      const add = await call(request, 'POST', `/carts/${id}`, { token: intruder.token, data: { product_id: product.id, quantity: 2 } });
      const remove = await call(request, 'DELETE', `/carts/${id}`, { token: intruder.token });

      expect.soft(REFUSED_OR_HIDDEN, `SEC-15: GET /carts/{id} of another customer's cart answered ${read.status()}`).toContain(read.status());
      expect.soft(REFUSED_OR_HIDDEN, `SEC-15: POST /carts/{id} (add a line) to another customer's cart answered ${add.status()}`).toContain(add.status());
      expect.soft(REFUSED_OR_HIDDEN, `SEC-15: DELETE /carts/{id} of another customer's cart answered ${remove.status()}`).toContain(remove.status());
      // What the owner is left with: the cart, with only their own line, however the three answers read.
      const after = await call(request, 'GET', `/carts/${id}`, { token: owner.token });
      expect.soft(after.status(), 'SEC-15: the owner still has the cart after the other customer touched it').toBe(200);
      // A cart that is gone answers with a message and no lines, which this reads as an empty cart (the status above says why).
      const left = ((await after.json().catch(() => ({}))) as Partial<Cart>).cart_items ?? [];
      expect.soft(left.map((item) => `${item.product.id} x${item.quantity}`), 'SEC-15: the owner\'s cart holds only the line they added').toEqual([`${product.id} x1`]);
    });
  });
});
