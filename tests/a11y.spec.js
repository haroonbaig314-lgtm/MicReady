// Automated accessibility checks (WCAG 2.1 A and AA) in light and dark mode.
const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const { PAGES, openDemo, startSession, rejectConsent } = require('./helpers');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const summarize = violations => violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);

for (const scheme of ['light', 'dark']) {
    test.describe(`${scheme} mode`, () => {
        test.use({ colorScheme: scheme, reducedMotion: 'reduce' });

        for (const name of PAGES) {
            test(`${name} has no WCAG violations`, async ({ page }) => {
                await page.goto('/' + name);
                const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
                expect(summarize(results.violations)).toEqual([]);
            });
        }

        test('live demo, progress panel and summary have no WCAG violations', async ({ page }) => {
            await openDemo(page);
            await page.evaluate(() => localStorage.setItem('verba_history', JSON.stringify([
                { t: Date.now() - 864e5, dur: 60, words: 140, wpm: 128, fil: 6, fpm: 6, score: 72, pau: 3, lpau: 0, hed: 2, lang: 'en-US', mode: 'pitch' },
                { t: Date.now(), dur: 90, words: 210, wpm: 150, fil: 3, fpm: 2, score: 86, pau: 6, lpau: 0, hed: 1, lang: 'en-US', mode: 'free' }])));
            await page.reload();
            await rejectConsent(page);
            await startSession(page);
            await page.evaluate(() => {
                document.dispatchEvent(new CustomEvent('verba:hesitation'));
                window.__emit('so I think we should like try it ', true);
            });
            let results = await new AxeBuilder({ page }).include('#demo').withTags(TAGS).analyze();
            expect(summarize(results.violations)).toEqual([]);
            await page.locator('#endSessionBtn').click({ force: true });
            await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
            await page.waitForTimeout(1000);
            results = await new AxeBuilder({ page }).include('#modalOverlay').withTags(TAGS).analyze();
            expect(summarize(results.violations)).toEqual([]);
        });
    });
}
