// Light by default; the sun/moon button switches to dark and is remembered.
const { test, expect } = require('@playwright/test');
const { PAGES, rejectConsent } = require('./helpers');

const bodyBg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = 'rgb(255, 255, 255)';
const DARK = 'rgb(15, 26, 20)';

test.describe('device set to dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('the site still opens in light mode @mobile', async ({ page }) => {
        await page.goto('/index.html');
        expect(await bodyBg(page)).toBe(LIGHT);
        await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-pressed', 'false');
    });
});

test('every page has the toggle in its header', async ({ page }) => {
    for (const name of PAGES) {
        await page.goto('/' + name);
        await expect(page.locator('header .theme-toggle'), name).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Dark mode' })).toBeVisible();
    }
});

test('the toggle switches to dark, is remembered across pages, and switches back @mobile', async ({ page }) => {
    await page.goto('/index.html');
    await rejectConsent(page);
    const toggle = page.locator('.theme-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', 'Switch to light mode');
    await expect.poll(() => bodyBg(page)).toBe(DARK);
    await page.goto('/privacy.html');
    expect(await bodyBg(page)).toBe(DARK);
    await page.locator('.theme-toggle').click();
    await expect.poll(() => bodyBg(page)).toBe(LIGHT);
    await page.reload();
    expect(await bodyBg(page)).toBe(LIGHT);
});

test('the toggle works from the keyboard', async ({ page }) => {
    await page.goto('/terms.html');
    await rejectConsent(page);
    await page.locator('.theme-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(' ');
    await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-pressed', 'false');
});
