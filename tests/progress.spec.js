// Progress history: opt-in, numbers only, chart, table, clearing.
const { test, expect } = require('@playwright/test');
const { openDemo, startSession } = require('./helpers');

async function finishSession(page, words) {
    await startSession(page);
    await page.evaluate(t => window.__emit(t, true), words);
    await page.clock.runFor(40000);
    await page.locator('#endSessionBtn').click({ force: true });
    await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
}

test('nothing is saved until the visitor opts in', async ({ page }) => {
    await openDemo(page, { clock: true });
    await expect(page.locator('#progressEmpty')).toContainText('Progress tracking is off');
    await finishSession(page, 'one two three four five six seven eight nine ten ');
    expect(await page.evaluate(() => localStorage.getItem('verba_history'))).toBeNull();
});

test('opting in saves numbers only and shows the panel', async ({ page }) => {
    await openDemo(page, { clock: true });
    await finishSession(page, 'secret words that must never be stored anywhere at all, like this sentence ');
    await page.check('#saveProgress');
    const raw = await page.evaluate(() => localStorage.getItem('verba_history'));
    expect(raw).not.toContain('secret');
    const list = JSON.parse(raw);
    expect(list).toHaveLength(1);
    for (const v of Object.values(list[0])) expect(['number', 'string']).toContain(typeof v);
    expect(Object.keys(list[0]).sort()).toEqual(['dur', 'fil', 'fpm', 'hed', 'lang', 'lpau', 'mode', 'pau', 'score', 't', 'words', 'wpm']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#progressBody')).toBeVisible();
    await expect(page.locator('.kpi').first()).toContainText('1');
    await expect(page.locator('#chartArea svg')).toHaveCount(1);
});

test('chart, tabs, table and streak with several sessions', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => {
        const day = 864e5, now = Date.now();
        localStorage.setItem('verba_history_opt', '1');
        localStorage.setItem('verba_history', JSON.stringify([3, 2, 1, 0].map((d, i) => ({
            t: now - d * day, dur: 60 + i * 10, words: 150, wpm: 120 + i * 10, fil: 6 - i, fpm: 6 - i,
            score: 70 + i * 5, pau: i, lpau: 0, hed: 0, lang: 'en-US', mode: 'free' }))));
    });
    await page.reload();
    await expect(page.locator('.kpi')).toHaveText([/Sessions\s*4/, /Day streak\s*4/, /Best score\s*85/, /Fillers per minute\s*4\.5/]);
    await expect(page.locator('#chartArea .series-line')).toHaveCount(1);
    await page.click('#tab-wpm');
    await expect(page.locator('#tab-wpm')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#chartTitle')).toContainText('words per minute');
    await page.locator('#chartArea').focus();
    await expect(page.locator('#chartTip')).toContainText('150 WPM');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#chartTip')).toContainText('140 WPM');
    await page.locator('.chart-table summary').click();
    await expect(page.locator('#historyTable tbody tr')).toHaveCount(4);
});

test('clearing history removes it after confirmation', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => localStorage.setItem('verba_history', JSON.stringify([{ t: Date.now(), dur: 60, words: 100, wpm: 100, fil: 1, fpm: 1, score: 90, pau: 1, lpau: 0, hed: 0, lang: 'en-US', mode: 'free' }])));
    await page.reload();
    page.once('dialog', d => d.accept());
    await page.click('#progressClear');
    expect(await page.evaluate(() => localStorage.getItem('verba_history'))).toBeNull();
    await expect(page.locator('#progressEmpty')).toBeVisible();
});
