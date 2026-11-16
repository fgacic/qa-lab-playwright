/**
 * The judgements of tests/security/headers.spec.ts, as plain functions of a header value: what makes a Content-Security-Policy,
 * a Strict-Transport-Security, a Referrer-Policy or a framing rule count as protection. They live here, apart from the spec, because
 * the spec runs only against the live site (@live-only) and a matcher that is wrong would otherwise show up as a wrong verdict
 * on a real deployment; tests/security/header-matchers.spec.ts feeds them sample values offline, on the gate.
 */

/** The directives of a Content-Security-Policy, by name (lower-cased), each with its source list. A repeated directive counts once, the first (as browsers read it). */
export function directivesOf(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/**
 * Sources that make a script-governing directive limit (almost) nothing: inline script, string-to-code (`eval`), any origin, any
 * origin of a scheme (`https:`, `http:`), or script in a data: URL. Compared case-insensitively. A policy that mixes one of these with
 * a nonce or `'strict-dynamic'` can still be sound (a browser ignores the wider source then); this suite's judgement is the plain one,
 * and it names the source it refused, so such a policy is a finding to read, not a silent verdict.
 */
export const UNSAFE_SCRIPT_SOURCES = ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:'];

/**
 * Whether a Content-Security-Policy limits where scripts may come from: it names a script source (`script-src`, else `default-src`), and none of the unsafe ones.
 * Deliberately only that (SEC-01 is "limits where scripts load from"): `object-src`, `base-uri`, `script-src-elem`, `frame-ancestors` and
 * the rest are not read, so a pass here is not a full audit of the policy.
 */
export function limitsScripts(policy: string): boolean {
  const directives = directivesOf(policy);
  const scripts = directives.get('script-src') ?? directives.get('default-src');
  return !!scripts && !scripts.some((source) => UNSAFE_SCRIPT_SOURCES.includes(source.toLowerCase()));
}

/** Strict-Transport-Security max-age (seconds) of at least 180 days, the lower bound Mozilla's web security guidelines call acceptable. */
export const MIN_HSTS_MAX_AGE_SECONDS = 15_552_000;

/** The max-age of a Strict-Transport-Security value, in seconds; 0 when it has none. */
export function hstsMaxAge(value: string): number {
  return Number(/(?:^|;)\s*max-age\s*=\s*"?(\d+)"?/i.exec(value)?.[1] ?? 0);
}

/** Referrer policies that never send the full URL to another origin. A comma list is a fallback chain: the last one the browser knows wins. */
export const SAFE_REFERRER_POLICIES = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];

/** Whether a Referrer-Policy value keeps the full URL from other origins (judged by the last entry of a fallback chain). */
export function keepsReferrerPrivate(value: string): boolean {
  return SAFE_REFERRER_POLICIES.includes(value.split(',').pop()!.trim().toLowerCase());
}

/**
 * Whether the headers stop the page being framed by another site: `X-Frame-Options` of deny or sameorigin, or a CSP `frame-ancestors`
 * that names something other than `*`. Either is enough, and each is judged on its own value: a "deny" inside a CSP is not an X-Frame-Options.
 */
export function restrictsFraming(headers: { frameOptions: string; policy: string }): boolean {
  const byFrameOptions = /^(deny|sameorigin)$/i.test(headers.frameOptions.trim());
  const ancestors = directivesOf(headers.policy).get('frame-ancestors') ?? [];
  const byPolicy = ancestors.length > 0 && !ancestors.includes('*');
  return byFrameOptions || byPolicy;
}

/** Whether a Permissions-Policy turns a feature off for everybody (`feature=()`). */
export function switchesOff(policy: string, feature: string): boolean {
  return policy.split(',').some((part) => part.trim().toLowerCase() === `${feature}=()`);
}

/** Whether an X-Content-Type-Options value is exactly `nosniff`. */
export function isNosniff(value: string): boolean {
  return /^nosniff$/i.test(value.trim());
}
