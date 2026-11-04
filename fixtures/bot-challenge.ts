import { test as base } from '@playwright/test';
import { BOT_CHALLENGE_REASON, isBotChallenge } from '@support/bot-challenge';
import { TARGET } from '@support/env';

export interface BotChallengeFixtures {
  /** Live only: notes when Cloudflare challenged any navigation of the test (see src/support/bot-challenge.ts). */
  botChallengeWatch: void;
}

export const test = base.extend<BotChallengeFixtures>({
  botChallengeWatch: [
    async ({ page }, use, testInfo) => {
      if (TARGET !== 'live') return use();
      const challenged: string[] = [];
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && isBotChallenge(frame.url())) challenged.push(new URL(frame.url()).pathname);
      });
      await use();
      if (challenged.length) testInfo.annotations.push({ type: 'bot challenge', description: `${BOT_CHALLENGE_REASON} Challenged: ${challenged.join(', ')}` });
    },
    { auto: true },
  ],
});
