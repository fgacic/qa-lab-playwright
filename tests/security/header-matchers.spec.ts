// The judgements behind tests/security/headers.spec.ts (src/support/security-headers.ts). That spec runs on the live site only, so a
// matcher that waved a weak header through, or refused a good one, would show up there as a wrong verdict on a real deployment. Here
// each matcher is fed sample values offline, a good one and a weak one per rule, and runs on the gate.
import { expect, test } from '@playwright/test';
import { directivesOf, hstsMaxAge, isNosniff, keepsReferrerPrivate, limitsScripts, MIN_HSTS_MAX_AGE_SECONDS, restrictsFraming, switchesOff, UNSAFE_SCRIPT_SOURCES } from '@support/security-headers';

test.describe('Security header matchers', { tag: ['@security', '@framework'] }, () => {
  test('a policy is read into its directives, the first of a repeated name winning', () => {
    const directives = directivesOf("Default-Src 'self' cdn.example; script-src 'none'; script-src *; ; img-src");

    expect([...directives.keys()], 'names are lower-cased, empty parts skipped').toEqual(['default-src', 'script-src', 'img-src']);
    expect(directives.get('default-src')).toEqual(["'self'", 'cdn.example']);
    expect(directives.get('script-src'), 'the first script-src is the one a browser uses').toEqual(["'none'"]);
    expect(directives.get('img-src'), 'a directive with no source has an empty list').toEqual([]);
  });

  const LIMITED = [
    "script-src 'self'",
    "default-src 'self'",
    "default-src *; script-src 'self' https://cdn.example",
    "SCRIPT-SRC 'SELF'",
    "script-src 'none'",
    "default-src 'self'; script-src 'self' 'nonce-abc123'",
  ];
  for (const policy of LIMITED) {
    test(`a policy that limits scripts is accepted: ${policy}`, () => {
      expect(limitsScripts(policy)).toBe(true);
    });
  }

  const UNLIMITED = [
    ['no policy at all', ''],
    ['no script source named', "img-src 'self'; style-src 'self'"],
    ['inline script allowed', "script-src 'self' 'unsafe-inline'"],
    ['inline script allowed, in another case', "script-src 'UNSAFE-INLINE'"],
    ['string-to-code allowed', "script-src 'self' 'unsafe-eval'"],
    ['any origin', 'script-src *'],
    ['any https origin', 'script-src https:'],
    ['any http origin', "default-src 'self' http:"],
    ['script in a data: URL', "script-src 'self' data:"],
    ['inherited from a default-src that allows everything', 'default-src *; img-src *'],
  ];
  for (const [name, policy] of UNLIMITED) {
    test(`a policy that limits nothing is refused: ${name}`, () => {
      expect(limitsScripts(policy)).toBe(false);
    });
  }

  test('every listed unsafe source makes a script-src limit nothing, and the list is the one the pin quotes', () => {
    expect(UNSAFE_SCRIPT_SOURCES).toEqual(["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:']);
    for (const source of UNSAFE_SCRIPT_SOURCES) expect(limitsScripts(`script-src 'self' ${source}`), `${source} makes script-src limit nothing`).toBe(false);
  });

  test('a Strict-Transport-Security max-age is read in seconds, and 0 when it has none', () => {
    expect(hstsMaxAge('max-age=31536000; includeSubDomains; preload')).toBe(31_536_000);
    expect(hstsMaxAge('includeSubDomains; max-age=15552000')).toBe(15_552_000);
    expect(hstsMaxAge('Max-Age = "63072000"'), 'case, spaces and quotes').toBe(63_072_000);
    expect(hstsMaxAge('includeSubDomains')).toBe(0);
    expect(hstsMaxAge('max-age=abc')).toBe(0);
    expect(hstsMaxAge(''), 'an absent header').toBe(0);
    expect(hstsMaxAge('s-max-age=31536000'), 'another directive that ends in max-age is not it').toBe(0);
  });

  test('the HSTS lower bound is 180 days, inclusive', () => {
    expect(hstsMaxAge(`max-age=${MIN_HSTS_MAX_AGE_SECONDS}`)).toBeGreaterThanOrEqual(MIN_HSTS_MAX_AGE_SECONDS);
    expect(hstsMaxAge(`max-age=${MIN_HSTS_MAX_AGE_SECONDS - 1}`)).toBeLessThan(MIN_HSTS_MAX_AGE_SECONDS);
    expect(MIN_HSTS_MAX_AGE_SECONDS).toBe(180 * 24 * 60 * 60);
  });

  test('nosniff is the only value of X-Content-Type-Options that counts', () => {
    expect(isNosniff('nosniff')).toBe(true);
    expect(isNosniff(' NoSniff ')).toBe(true);
    expect(isNosniff('')).toBe(false);
    expect(isNosniff('nosniff, nosniff'), 'a repeated header is not the value').toBe(false);
    expect(isNosniff('sniff')).toBe(false);
  });

  test('a Referrer-Policy counts when its last entry keeps the full URL from other origins', () => {
    for (const value of ['no-referrer', 'same-origin', 'strict-origin', 'Strict-Origin-When-Cross-Origin', 'unsafe-url, strict-origin-when-cross-origin']) {
      expect(keepsReferrerPrivate(value), value).toBe(true);
    }
    for (const value of ['unsafe-url', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin, unsafe-url', '']) {
      expect(keepsReferrerPrivate(value), value).toBe(false);
    }
  });

  test('framing is restricted by X-Frame-Options or by a frame-ancestors that is not a wildcard, each judged on its own header', () => {
    expect(restrictsFraming({ frameOptions: 'DENY', policy: '' })).toBe(true);
    expect(restrictsFraming({ frameOptions: ' sameorigin ', policy: '' })).toBe(true);
    expect(restrictsFraming({ frameOptions: '', policy: "default-src 'self'; frame-ancestors 'none'" })).toBe(true);
    expect(restrictsFraming({ frameOptions: '', policy: "frame-ancestors 'self' https://partner.example" })).toBe(true);

    expect(restrictsFraming({ frameOptions: '', policy: '' }), 'neither header').toBe(false);
    expect(restrictsFraming({ frameOptions: 'ALLOW-FROM https://partner.example', policy: '' }), 'a value browsers no longer honour').toBe(false);
    expect(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors *' })).toBe(false);
    expect(restrictsFraming({ frameOptions: '', policy: "frame-ancestors 'self' *" }), 'a wildcard among the sources').toBe(false);
    expect(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors' }), 'a directive with no source names nobody').toBe(false);
    expect(restrictsFraming({ frameOptions: '', policy: "script-src 'none'" }), 'a CSP without frame-ancestors does not restrict framing').toBe(false);
    expect(restrictsFraming({ frameOptions: "frame-ancestors 'none'", policy: '' }), 'a CSP value in the X-Frame-Options header is not an X-Frame-Options').toBe(false);
    expect(restrictsFraming({ frameOptions: '', policy: 'deny' }), 'a "deny" inside a CSP is not an X-Frame-Options').toBe(false);
  });

  test('a Permissions-Policy switches a feature off only with an empty allowlist', () => {
    const policy = 'camera=(), microphone=(), geolocation=(self)';

    expect(switchesOff(policy, 'camera')).toBe(true);
    expect(switchesOff(policy, 'microphone')).toBe(true);
    expect(switchesOff(policy, 'geolocation'), 'allowed for the page itself').toBe(false);
    expect(switchesOff(policy, 'payment'), 'not mentioned').toBe(false);
    expect(switchesOff('Camera=()', 'camera'), 'case').toBe(true);
    expect(switchesOff('xcamera=()', 'camera'), 'a longer feature name is not this one').toBe(false);
    expect(switchesOff('', 'camera')).toBe(false);
  });
});
