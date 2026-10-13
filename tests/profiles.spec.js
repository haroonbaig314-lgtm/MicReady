// Profiles (MVP): several people on one device, each with their own progress history.
const { test, expect } = require('@playwright/test');
const { openMvp, startSession } = require('./helpers');

async function addPerson(page, name) {
    await page.click('#profileAddBtn');
    await page.fill('#profileName', name);
    await page.click('#profileForm button[type=submit]');
    await expect(page.locator('#profileSelect option:checked')).toHaveText(name);
}

async function finishSession(page, words) {
    await startSession(page);
    await page.evaluate(t => window.__emit(t, true), words);
    await page.clock.runFor(15000);
    await page.locator('#endSessionBtn').click({ force: true });
    await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
}

test('each person has their own progress history', async ({ page }) => {
    test.setTimeout(120000);
    await openMvp(page, { clock: true });
    await expect(page.locator('#profileSelect option')).toHaveText(['Me']);
    await expect(page.locator('#progressTitle')).toHaveText('Your progress');
    await page.click('#progressEnable');

    await finishSession(page, 'this is my own practice session with enough words to count ');
    await page.click('#closeModal');
    await addPerson(page, 'Maya');
    await expect(page.locator('#progressTitle')).toHaveText('Maya’s progress');
    await expect(page.locator('#progressEmpty')).toBeVisible();

    await finishSession(page, 'and this one belongs to Maya, who is practicing her pitch today ');
    await expect(page.locator('#saveProgressText')).toHaveText('Save this session to Maya’s progress');
    await page.click('#closeModal');
    await expect(page.locator('#progressBody')).toBeVisible();

    const stored = await page.evaluate(() => {
        const profiles = JSON.parse(localStorage.getItem('verba_profiles'));
        const maya = profiles.list.find(p => p.name === 'Maya');
        return { mine: JSON.parse(localStorage.getItem('verba_history')).length, maya: JSON.parse(localStorage.getItem('verba_history:' + maya.id)).length };
    });
    expect(stored).toEqual({ mine: 1, maya: 1 });

    await page.selectOption('#profileSelect', { label: 'Me' });
    await expect(page.locator('#progressTitle')).toHaveText('Your progress');
    await expect(page.locator('.kpi').first()).toContainText('1');
});

test('rename and remove a person; their history goes with them', async ({ page }) => {
    await openMvp(page);
    await addPerson(page, 'Sam');
    await page.evaluate(() => {
        const id = JSON.parse(localStorage.getItem('verba_profiles')).active;
        localStorage.setItem('verba_history:' + id, JSON.stringify([{ t: Date.now(), dur: 30, words: 60, wpm: 120, fil: 1, fpm: 2, score: 90, pau: 1, lpau: 0, hed: 0, lang: 'en-US', mode: 'free' }]));
    });
    await page.click('#profileEditBtn');
    await page.fill('#profileName', 'Samuel');
    await page.click('#profileForm button[type=submit]');
    await expect(page.locator('#profileSelect option')).toHaveText(['Me', 'Samuel']);

    await page.click('#profileEditBtn');
    page.once('dialog', d => d.accept());
    await page.click('#profileRemove');
    await expect(page.locator('#profileSelect option')).toHaveText(['Me']);
    const left = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('verba_history:')));
    expect(left).toEqual([]);
    // The last profile cannot be removed.
    await page.click('#profileEditBtn');
    await expect(page.locator('#profileRemove')).toBeHidden();
});

test('profiles cannot be switched by hand during a session', async ({ page }) => {
    await openMvp(page);
    await addPerson(page, 'Ana');
    await startSession(page);
    await expect(page.locator('#profileSelect')).toBeDisabled();
    await expect(page.locator('#profileAddBtn')).toBeDisabled();
    await page.locator('#endSessionBtn').click({ force: true });
    await page.click('#closeModal');
    await expect(page.locator('#profileSelect')).toBeEnabled();
});

test('a profile name is shown as text, never as markup', async ({ page }) => {
    await openMvp(page);
    await addPerson(page, '<img src=x onerror=alert(1)>');
    await expect(page.locator('#profileBar img')).toHaveCount(0);
});
