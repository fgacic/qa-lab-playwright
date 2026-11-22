// The judgements behind tests/security/headers.spec.ts (src/support/security-headers.ts). That spec runs on the live site only, so a
// matcher that waved a weak header through, or refused a good one, would show up there as a wrong verdict on a real deployment. Here
// each matcher is fed sample values offline, a good one and a weak one per rule, and runs on the gate.
import { expect, test } from '@playwright/test';
import { directivesOf, hstsMaxAge, isNosniff, keepsReferrerPrivate, limitsScripts, MIN_HSTS_MAX_AGE_SECONDS, restrictsFraming, switchesOff, UNSAFE_SCRIPT_SOURCES } from '@support/security-headers';

test.describe('Security header matchers', { tag: ['@security', '@framework'] }, () => {
  test('a policy is read into its directives, the first of a repeated name winning', () => {
    const directives = directivesOf("Default-Src 'self' cdn.example; script-src 'none'; script-src *; ; img-src");

    expect.soft([...directives.keys()], 'names are lower-cased, empty parts skipped').toEqual(['default-src', 'script-src', 'img-src']);
    expect.soft(directives.get('default-src'), 'the sources of default-src, in order').toEqual(["'self'", 'cdn.example']);
    expect.soft(directives.get('script-src'), 'the first script-src is the one a browser uses').toEqual(["'none'"]);
    expect.soft(directives.get('img-src'), 'a directive with no source has an empty list').toEqual([]);
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
    expect.soft(UNSAFE_SCRIPT_SOURCES, 'the list the pin quotes').toEqual(["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:']);
    for (const source of UNSAFE_SCRIPT_SOURCES) expect.soft(limitsScripts(`script-src 'self' ${source}`), `${source} makes script-src limit nothing`).toBe(false);
  });

  test('a Strict-Transport-Security max-age is read in seconds, and 0 when it has none', () => {
    expect.soft(hstsMaxAge('max-age=31536000; includeSubDomains; preload'), 'the plain form, with the other directives after it').toBe(31_536_000);
    expect.soft(hstsMaxAge('includeSubDomains; max-age=15552000'), 'max-age after another directive').toBe(15_552_000);
    expect.soft(hstsMaxAge('Max-Age = "63072000"'), 'case, spaces and quotes').toBe(63_072_000);
    expect.soft(hstsMaxAge('includeSubDomains'), 'no max-age at all').toBe(0);
    expect.soft(hstsMaxAge('max-age=abc'), 'a max-age that is not a number').toBe(0);
    expect.soft(hstsMaxAge(''), 'an absent header').toBe(0);
    expect.soft(hstsMaxAge('s-max-age=31536000'), 'another directive that ends in max-age is not it').toBe(0);
  });

  test('the HSTS lower bound is 180 days, inclusive', () => {
    expect.soft(hstsMaxAge(`max-age=${MIN_HSTS_MAX_AGE_SECONDS}`), 'the bound itself passes').toBeGreaterThanOrEqual(MIN_HSTS_MAX_AGE_SECONDS);
    expect.soft(hstsMaxAge(`max-age=${MIN_HSTS_MAX_AGE_SECONDS - 1}`), 'one second under the bound fails').toBeLessThan(MIN_HSTS_MAX_AGE_SECONDS);
    expect.soft(MIN_HSTS_MAX_AGE_SECONDS, 'the bound is 180 days in seconds').toBe(180 * 24 * 60 * 60);
  });

  test('nosniff is the only value of X-Content-Type-Options that counts', () => {
    expect.soft(isNosniff('nosniff'), 'the plain value').toBe(true);
    expect.soft(isNosniff(' NoSniff '), 'case and spaces').toBe(true);
    expect.soft(isNosniff(''), 'an absent header').toBe(false);
    expect.soft(isNosniff('nosniff, nosniff'), 'a repeated header is not the value').toBe(false);
    expect.soft(isNosniff('sniff'), 'another value').toBe(false);
  });

  test('a Referrer-Policy counts when its last entry keeps the full URL from other origins', () => {
    for (const value of ['no-referrer', 'same-origin', 'strict-origin', 'Strict-Origin-When-Cross-Origin', 'unsafe-url, strict-origin-when-cross-origin']) {
      expect.soft(keepsReferrerPrivate(value), value).toBe(true);
    }
    for (const value of ['unsafe-url', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin, unsafe-url', '']) {
      expect.soft(keepsReferrerPrivate(value), value).toBe(false);
    }
  });

  test('framing is restricted by X-Frame-Options or by a frame-ancestors that is not a wildcard, each judged on its own header', () => {
    expect.soft(restrictsFraming({ frameOptions: 'DENY', policy: '' }), 'DENY').toBe(true);
    expect.soft(restrictsFraming({ frameOptions: ' sameorigin ', policy: '' }), 'SAMEORIGIN, in any case, with spaces').toBe(true);
    expect.soft(restrictsFraming({ frameOptions: '', policy: "default-src 'self'; frame-ancestors 'none'" }), "frame-ancestors 'none'").toBe(true);
    expect.soft(restrictsFraming({ frameOptions: '', policy: "frame-ancestors 'self' https://partner.example" }), 'frame-ancestors with named sources').toBe(true);

    expect.soft(restrictsFraming({ frameOptions: '', policy: '' }), 'neither header').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: 'ALLOW-FROM https://partner.example', policy: '' }), 'a value browsers no longer honour').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors *' }), 'a wildcard frame-ancestors').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: "frame-ancestors 'self' *" }), 'a wildcard among the sources').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors https:' }), 'a bare https: scheme lets every https site frame the page').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: "frame-ancestors 'self' http: data:" }), 'bare http: and data: schemes among the sources').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors HTTPS:' }), 'a scheme in any case').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: 'DENY', policy: 'frame-ancestors https:' }), 'X-Frame-Options still counts on its own').toBe(true);
    expect.soft(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors https://partner.example' }), 'a scheme with a host is a named source').toBe(true);
    expect.soft(restrictsFraming({ frameOptions: '', policy: 'frame-ancestors' }), 'a directive with no source names nobody').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: "script-src 'none'" }), 'a CSP without frame-ancestors does not restrict framing').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: "frame-ancestors 'none'", policy: '' }), 'a CSP value in the X-Frame-Options header is not an X-Frame-Options').toBe(false);
    expect.soft(restrictsFraming({ frameOptions: '', policy: 'deny' }), 'a "deny" inside a CSP is not an X-Frame-Options').toBe(false);
  });

  test('a Permissions-Policy switches a feature off only with an empty allowlist', () => {
    const policy = 'camera=(), microphone=(), geolocation=(self)';

    expect.soft(switchesOff(policy, 'camera'), 'camera=()').toBe(true);
    expect.soft(switchesOff(policy, 'microphone'), 'microphone=()').toBe(true);
    expect.soft(switchesOff(policy, 'geolocation'), 'allowed for the page itself').toBe(false);
    expect.soft(switchesOff(policy, 'payment'), 'not mentioned').toBe(false);
    expect.soft(switchesOff('Camera=()', 'camera'), 'case').toBe(true);
    expect.soft(switchesOff('xcamera=()', 'camera'), 'a longer feature name is not this one').toBe(false);
    expect.soft(switchesOff('', 'camera'), 'an absent header').toBe(false);
  });
});
