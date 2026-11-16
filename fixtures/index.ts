import { mergeExpects, mergeTests } from '@playwright/test';
import { test as a11yTest } from './a11y';
import { test as adminTokenTest } from './admin-token';
import { test as adminTest } from './admin';
import { test as allureLabelsTest } from './allure-labels';
import { test as apiTest } from './api';
import { test as authTest } from './auth';
import { test as botChallengeTest } from './bot-challenge';
import { test as consoleGuardTest } from './console-guard';
import { collectionExpect, moneyExpect } from './matchers';
import { test as pagesTest } from './pages';
import { test as performanceTest } from './performance';
import { test as securityTest } from './security';

/** The suite's `test` and `expect`. Specs import only from here. */
export const test = mergeTests(pagesTest, authTest, adminTest, a11yTest, securityTest, performanceTest, botChallengeTest, consoleGuardTest, allureLabelsTest);

/**
 * For specs that never open a page (`@api`, raw HTTP checks): the API client, the catalogue, the admin token and the
 * report labels, and none of the browser fixtures. The suite's auto fixtures (the XSS sentinel, the bot-challenge
 * watch, the vitals collector, the console guard, the product cleanup) all need a `page`, so a spec on `test` pays a
 * browser context even when it only uses `request`; one on `apiOnlyTest` opens no context at all.
 */
export const apiOnlyTest = mergeTests(apiTest, adminTokenTest, allureLabelsTest);
export const expect = mergeExpects(collectionExpect, moneyExpect);

export { mock, withMocks } from '@support/api-mock';
