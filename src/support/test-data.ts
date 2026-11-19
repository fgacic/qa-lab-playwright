/**
 * Unique, obviously fake data per run. Nothing here is a real person, address or card.
 * Emails use example.com (RFC 2606), so nothing is ever delivered anywhere.
 */
// The worker's parallel index makes two workers that start in the same millisecond with the same random digits still differ.
// Not replayable on purpose (it must differ from every other run's data). It is part of every email below, so the data of a failure names its run.
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}w${process.env.TEST_PARALLEL_INDEX ?? '0'}`;
let counter = 0;

export function uniqueEmail(prefix = 'qa-lab'): string {
  counter += 1;
  return `${prefix}.${runId}.${counter}@example.com`;
}

export interface Person {
  firstName: string;
  lastName: string;
  email: string;
}

export interface Address {
  /** ISO 3166-1 alpha-2, the value of the country option. */
  country: string;
  postalCode: string;
  houseNumber: string;
  street: string;
  city: string;
  state: string;
}

export interface Customer extends Person {
  dateOfBirth: string;
  phone: string;
  password: string;
  address: Address;
}

const fakePerson = (emailPrefix: string): Person => ({ firstName: 'Testy', lastName: 'McTestface', email: uniqueEmail(emailPrefix) });

export function fakeGuest(): Person {
  return fakePerson('guest');
}

/**
 * Postcode and house number are what the lookup needs; street, city and state are fallbacks
 * for when it finds nothing. The postcode is Dutch-format because the forms validate it per country.
 */
export function fakeAddress(): Address {
  return {
    country: 'NL',
    postalCode: '1234 AB',
    houseNumber: '1',
    street: 'Test Street',
    city: 'Testville',
    state: 'Teststate',
  };
}

export function fakeCustomer(): Customer {
  return {
    ...fakePerson('customer'),
    dateOfBirth: '1990-01-01',
    phone: '0123456789',
    password: `Qa-lab-${runId}!9`,
    address: fakeAddress(),
  };
}

/** A message the contact form accepts: it must be at least 50 characters. */
export const CONTACT_MESSAGE =
  'Automated test message from the qa-lab Playwright suite. Please ignore it.';
