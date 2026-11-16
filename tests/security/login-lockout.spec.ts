import { mergeTests } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { cleanupTest } from '@fixtures/security';
import { call, newCustomer, profileBody, type Account, type World } from '@support/authz';
import { knownBug } from '@support/known-bug';
import { fromBase64Url } from '@support/payloads';
import { uniqueEmail } from '@support/test-data';

/**
 * Guessing passwords: what the login does with a run of wrong ones. These send a handful of failed sign-ins, so they only ever run
 * against the self-hosted Toolshop (@self-hosted), never the public site, and only ever against accounts the test made (an account that
 * locks stays locked, so a seeded one is never used). Plain HTTP, tagged @api so they run once.
 *
 * What the shop does today, found by trying it: a customer's account locks after three wrong passwords (the API answers 423, and then
 * refuses the right password too); a wrong password for an address that has no account is a 401 every time, however many are sent
 * (so there is no limit per client); and an account with the admin role never locks, whatever is sent. The lock is checked with a
 * control (the account signs in with the right password first), and the two gaps are pinned (SEC-16, SEC-17).
 */
const test = mergeTests(apiOnlyTest, cleanupTest);

/** What a locked account is answered, and what a rate limit would be answered. */
const LOCKED = [423, 429];
/** Wrong passwords sent to one account: more than the lock needs (three), so a lock of a slightly different size is still seen. */
const WRONG_PASSWORDS = 8;
/** Wrong passwords sent to addresses nobody has: enough for any per-minute limit a login would reasonably have. */
const GUESSES_AT_UNKNOWN = 30;

const login = (world: Pick<World, 'request'>, email: string, password: string) => call(world.request, 'POST', '/users/login', { data: { email, password } });

/** The answers to `count` wrong passwords for one account, in order. */
async function wrongPasswords(world: Pick<World, 'request'>, email: string, count: number): Promise<number[]> {
  const answers: number[] = [];
  for (let attempt = 1; attempt <= count; attempt++) answers.push((await login(world, email, `not-the-password-${attempt}`)).status());
  return answers;
}

test.describe('Login, repeated wrong passwords (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  test('a customer account locks after a run of wrong passwords, and then refuses the right one too', async ({ request, api, adminToken, cleanups }) => {
    const world = { request, api, adminToken, cleanups };
    const { customer } = await newCustomer(world);
    // The control: before the wrong ones, the right password signs in, so a refusal later is the lock and not a wrong credential.
    expect((await login(world, customer.email, customer.password)).status(), 'the right password signs the new customer in').toBe(200);

    const answers = await wrongPasswords(world, customer.email, WRONG_PASSWORDS);

    expect(answers[0], 'the first wrong password is an ordinary refusal').toBe(401);
    expect(answers.some((status) => LOCKED.includes(status)), `some of ${WRONG_PASSWORDS} wrong passwords were answered with a lock (answers: ${answers.join(', ')})`).toBe(true);
    expect(LOCKED, 'the right password is refused while the account is locked').toContain((await login(world, customer.email, customer.password)).status());
  });

  test.describe('the gaps', { tag: ['@bug'] }, () => {
    test('an account with the admin role locks after a run of wrong passwords too', async ({ request, api, adminToken, cleanups }) => {
      knownBug('SEC-16', 'an account with the admin role never locks: any number of wrong passwords is answered 401, so the most powerful account can be guessed at without limit.');
      const world = { request, api, adminToken, cleanups };
      // A throwaway account made an admin, never the seeded one: if the shop is fixed, this pin locks the account it made and nobody else's.
      const account: Account = await newCustomer(world);
      const promoted = await call(request, 'PUT', `/users/${account.id}`, { token: await adminToken(), data: profileBody(account, { role: 'admin' }) });
      expect(promoted.status(), 'the admin gave the account the admin role').toBe(200);
      const signedIn = await (await login(world, account.customer.email, account.customer.password)).json();
      expect(fromBase64Url<{ role: string }>(signedIn.access_token.split('.')[1]).role, 'a new sign-in carries the admin role').toBe('admin');

      const answers = await wrongPasswords(world, account.customer.email, WRONG_PASSWORDS);

      expect(answers.some((status) => LOCKED.includes(status)), `SEC-16: ${WRONG_PASSWORDS} wrong passwords for an admin account were answered ${answers.join(', ')}, none with a lock`).toBe(true);
    });

    test('guessing at addresses that have no account is limited per client', async ({ request }) => {
      knownBug('SEC-17', `${GUESSES_AT_UNKNOWN} sign-in attempts in a row from one client are all answered 401: there is no limit on the rate of guesses, only a lock on one existing customer account.`);
      const answers: number[] = [];

      for (let attempt = 0; attempt < GUESSES_AT_UNKNOWN; attempt++) {
        answers.push((await login({ request }, uniqueEmail('guess'), 'not-the-password')).status());
      }

      // Precondition, true whether or not the bug is fixed: every answer is a refusal of the credentials or a limit, never a success or a failure of the shop.
      expect(answers.every((status) => status === 401 || status === 429), `every attempt was refused (answers: ${[...new Set(answers)].join(', ')})`).toBe(true);
      expect(answers.includes(429), `SEC-17: ${GUESSES_AT_UNKNOWN} attempts were all answered ${[...new Set(answers)].join(', ')}, none with a rate limit (429)`).toBe(true);
    });
  });
});
