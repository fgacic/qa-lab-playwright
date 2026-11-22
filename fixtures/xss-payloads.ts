// The injection payloads of the XSS specs and the ids the sentinel's hits carry. Data only: the sentinel that watches for them is
// in ./xss-sentinel.ts, and the fixtures that hand it to a spec are in ./security.ts (which re-exports both).
/**
 * Injection payloads, typed into forms as plain text; the specs then check the text comes back as
 * text. Each one calls `__qaLabXssHit`, a function the sentinel exposes to the page, so running
 * it is recorded whether or not it opens a dialog (a payload that fetches, writes to the DOM or
 * redirects is caught the same way). Each is at most 40 characters, the longest search the shop
 * accepts (BUG-27), so one can be searched for. The number it passes says which one ran.
 *
 * Caveat shared by every payload that uses `<img src=x>`: the DOM check (`injectedCount`) recognises a parsed payload by the
 * attribute `src="x"`, so a payload that used another source would go uncounted, and a genuine image whose source is
 * exactly "x" would be counted wrongly. The sentinel's own hit record does not depend on it, which is why both checks are made.
 */
export const XSS_PAYLOADS = {
  'img onerror': `<img src=x onerror=__qaLabXssHit(1)>`,
  'script tag': `<script>__qaLabXssHit(2)</script>`,
  'svg onload, breaking out of an attribute': `"><svg onload=__qaLabXssHit(3)>`,
} as const;
/** The longest term the shop's search box acts on: a longer one is silently dropped, no request and no message (BUG-27). */
export const MAX_SEARCH_TERM = 40;
export type XssPayload = (typeof XSS_PAYLOADS)[keyof typeof XSS_PAYLOADS];

/**
 * The same three attacks, for the address bar. They call the hook as a tagged template
 * (a name followed by a backtick string) instead of with parentheses: Angular's router reads
 * `(...)` in a URL as a secondary outlet, so a payload with a call in it is redirected home before
 * the page ever sees it. The number it passes still says which one ran.
 */
export const ROUTE_XSS_PAYLOADS = {
  'img onerror': '<img src=x onerror=__qaLabXssHit`4`>',
  'script tag': '<script>__qaLabXssHit`5`</script>',
  'svg onload, breaking out of an attribute': '"><svg onload=__qaLabXssHit`6`>',
} as const;

/**
 * A payload for a value that lands in an HTML attribute (an `alt`, a `title`, an `href`, an input's `value`), with the sink it
 * is the control for: what a vulnerable page would build from it. Each calls `__qaLabXssHit`, so a hit says which one ran.
 * - quote break: closes the quote and adds a handler of its own, with no angle bracket, which is what a filter that only strips
 *   tags lets through; `autofocus` is what makes it run without a click (the control focuses the element itself, see
 *   `insertInAttributeSink`);
 * - srcdoc: the same break, adding a `srcdoc` to an iframe, whose script the browser runs;
 * - `javascript:` URL: a value that is itself the whole URL of a link, which runs when the link is followed (`activate`);
 * - entity-encoded: the quote arrives as `&quot;` and a sink that decodes entities before it builds the attribute turns it into a real one.
 * These are longer than the payloads above (up to 51 characters: they need a quote, a handler and the closing quote of the sink), so only
 * the ones that fit the search box's 40 characters (BUG-27) can be searched for, and the first name cap (also 40) rules the rest out as a first name.
 */
export interface AttributePayload {
  payload: string;
  /** The markup a vulnerable page would build around the value. */
  sink: (value: string) => string;
  /** Whether the payload only runs once the sink's link is followed. */
  activate?: 'click';
  /** What a safe page puts in the sink instead (the control): escaping for a text attribute, a scheme check for a URL. */
  neutralise: (value: string) => string;
}
const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const ATTRIBUTE_XSS_PAYLOADS: Record<string, AttributePayload> = {
  'a quote that adds a focus handler': { payload: '" autofocus onfocus=__qaLabXssHit(7) x="', sink: (value) => `<input value="${value}">`, neutralise: escapeAttribute },
  'a quote that adds a srcdoc': { payload: '" srcdoc="<script>__qaLabXssHit(8)</script>" x="', sink: (value) => `<iframe title="${value}"></iframe>`, neutralise: escapeAttribute },
  'a javascript: URL': { payload: 'javascript:__qaLabXssHit(9)', sink: (value) => `<a href="${value}">link</a>`, activate: 'click', neutralise: (value) => `#${encodeURIComponent(value)}` },
  'an entity-encoded quote': {
    payload: '&quot; autofocus onfocus=__qaLabXssHit(10) x=&quot;',
    // A sink that decodes entities before it puts the text in the attribute: the one place `&quot;` becomes a quote.
    sink: (value) => `<input value="${value.replaceAll('&quot;', '"')}">`,
    neutralise: escapeAttribute,
  },
};

/**
 * The hit ids of the sentinel's own controls (tests/security/xss-sentinel.spec.ts). The payloads above use 1 to 10, so a control takes the
 * next numbers: a hit from a payload can never be mistaken for a control's, nor the other way round. A new payload takes the next free number.
 */
export const SENTINEL_CONTROL_HIT = { shadowRoot: 11, frame: 12 } as const;
