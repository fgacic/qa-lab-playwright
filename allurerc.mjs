import { defineConfig } from 'allure';

/**
 * Allure 3. History lives in a JSON-lines file: CI downloads the one published with the last
 * report on GitHub Pages, generation appends this run to it, and the file is published again
 * next to the new report. That is what feeds the Trend, Duration and Retries charts.
 */
export default defineConfig({
  name: 'qa-lab-playwright: Toolshop UI suite',
  output: './allure-report',
  historyPath: './allure-history/history.jsonl',
  historyLimit: 30,
  appendHistory: true,
  plugins: {
    awesome: {
      options: {
        reportName: 'qa-lab-playwright',
        reportLanguage: 'en',
        groupBy: ['parentSuite', 'suite', 'subSuite'],
      },
    },
  },
});
