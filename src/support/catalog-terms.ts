/**
 * Terms of the seeded catalogue that several catalogue specs search or filter by: one name each, so a rename of the
 * seed is one edit. The search term is lower case as a shopper types it, the category as the filter menu spells it.
 * Only their existence is assumed here; every spec reads what they match from the API's own answer.
 */
export const PLIERS = { term: 'pliers', category: 'Pliers' } as const;
export const HAMMER = { term: 'hammer', category: 'Hammer' } as const;

/** The parent categories of the catalogue, by slug, with the title their page carries. */
export const HAND_TOOLS = { slug: 'hand-tools', title: 'Category: Hand Tools' } as const;
export const POWER_TOOLS = { slug: 'power-tools', title: 'Category: Power Tools' } as const;
export const OTHER = { slug: 'other', title: 'Category: Other' } as const;
export const CATEGORIES = [HAND_TOOLS, POWER_TOOLS, OTHER] as const;

/** An id shaped like the shop's own (26 characters) that no product has. */
export const UNKNOWN_PRODUCT_ID = '01QALABNOSUCHPRODUCT0000000';

/**
 * The name of a product this suite made for one test ("QaLab ..." in the back-office journeys, "Qa Lab ..." in the stored-XSS
 * checks). Those products are rentals, so the default catalogue never lists them, but a rentals list, a search that reaches
 * rentals or a pick of "any rental" can: a spec that reads those compares only the seeded products, so a product another
 * worker has up at that moment cannot change its result.
 */
export const SUITE_OWNED_NAME = /qa ?lab/i;
