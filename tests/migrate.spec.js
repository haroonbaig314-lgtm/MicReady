// Data saved under the storage names used before the rename to MicReady carries over.
const { test, expect } = require('@playwright/test');

const OLD = 'verba_';

test('saved settings, profiles and progress move to the new storage names', async ({ page }) => {
    const session = { t: Date.now(), dur: 60, words: 120, wpm: 120, fil: 2, fpm: 2, score: 88, pau: 3, lpau: 0, hed: 1, lang: 'en-US', mode: 'free' };
    await page.addInitScript(([old, s]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(old + 'consent', 'rejected');
        localStorage.setItem(old + 'theme', 'dark');
        localStorage.setItem(old + 'disclaimer_seen', '1');
        localStorage.setItem(old + 'history_opt', '1');
        localStorage.setItem(old + 'history', JSON.stringify([s]));
        localStorage.setItem(old + 'profiles', JSON.stringify({ list: [{ id: 'default', name: 'Me' }, { id: 'p1', name: 'Maya' }], active: 'default' }));
        localStorage.setItem(old + 'history:p1', JSON.stringify([s, s]));
    }, [OLD, session]);
    await page.goto('/mvp.html');

    const store = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
    expect(Object.keys(store).filter(k => k.startsWith(OLD))).toEqual([]);
    expect(store.micready_consent).toBe('rejected');
    expect(store.micready_theme).toBe('dark');
    expect(store.micready_disclaimer_seen).toBe('1');
    expect(JSON.parse(store.micready_history)).toHaveLength(1);
    expect(JSON.parse(store['micready_history:p1'])).toHaveLength(2);

    // The page picks the moved choices up: dark mode, no cookie banner, both profiles, and the
    // saved session in the progress panel.
    await expect(page.locator('#darkCss')).toHaveAttribute('media', 'all');
    await expect(page.locator('.consent-banner')).toBeHidden();
    await expect(page.locator('#profileSelect option')).toHaveText(['Me', 'Maya']);
    await expect(page.locator('#progressEmpty')).toBeHidden();
});
