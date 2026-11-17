/**
 * The shop's cart requests and the payment answer, named once: the cart, catalogue and checkout specs
 * wait for these requests and mock them, and a second copy of a pattern is a copy that can drift.
 */

/** The cart itself: `POST` adds a product, `GET` reads it, `DELETE` drops it once an order is placed. */
export const CART = /^\/carts\/[^/]+$/;
/** The request that saves a quantity. */
export const SAVE_QUANTITY = /^\/carts\/[^/]+\/product\/quantity$/;
/** The request that removes a line. */
export const REMOVE_LINE = /^\/carts\/[^/]+\/product\/[^/]+$/;

/** What the payment check answers when it passes. */
export const PAYMENT_PASSED = { message: 'Payment was successful' };
