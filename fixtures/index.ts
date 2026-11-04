import { mergeExpects, mergeTests } from '@playwright/test';
import { test as a11yTest } from './a11y';
import { test as adminTest } from './admin';
import { test as authTest } from './auth';
import { test as botChallengeTest } from './bot-challenge';
import { collectionExpect, moneyExpect } from './matchers';
import { test as pagesTest } from './pages';
import { test as performanceTest } from './performance';
import { test as securityTest } from './security';

/** The suite's `test` and `expect`. Specs import only from here. */
export const test = mergeTests(pagesTest, authTest, adminTest, a11yTest, securityTest, performanceTest, botChallengeTest);
export const expect = mergeExpects(collectionExpect, moneyExpect);

export { mock, withMocks } from '@support/api-mock';
