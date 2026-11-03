import { mergeExpects, mergeTests } from '@playwright/test';
import { test as authTest } from './auth';
import { collectionExpect, moneyExpect } from './matchers';
import { test as pagesTest } from './pages';

/** The suite's `test` and `expect`. Specs import only from here. */
export const test = mergeTests(pagesTest, authTest);
export const expect = mergeExpects(collectionExpect, moneyExpect);

export { mock, withMocks } from '@support/api-mock';
