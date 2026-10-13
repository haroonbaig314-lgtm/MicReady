// Cookie banner: equal choices, nothing third-party before consent, settings reopen it.
const { test, expect } = require('@playwright/test');

const BEEHIIV = 'https://subscribe-forms.beehiiv.com/**';

test.beforeEach(async ({ page }) => {
    // Never reach the real newsletter service from tests.
    await page.route(BEEHIIV, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>form</body></html>' }));
});

test('banner shows on first visit and nothing third-party loads before consent @mobile', async ({ page }) => {
    const external = [];
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
    await page.goto('/index.html');
    await expect(page.locator('.consent-banner')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(external).toEqual([]);
});

test('rejecting keeps the form unloaded and is remembered', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('[data-consent="rejected"]');
    await expect(page.locator('.consent-banner')).toBeHidden();
    await page.reload();
    await expect(page.locator('.consent-banner')).toBeHidden();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('[data-allow-embed]')).toBeVisible();
});

test('accepting loads the signup form', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('[data-consent="accepted"]');
    await expect(page.locator('iframe[title*="beehiiv"]')).toHaveCount(1);
});

test('"Load signup form" counts as consent', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('[data-consent="rejected"]');
    await page.click('[data-allow-embed]');
    await expect(page.locator('iframe[title*="beehiiv"]')).toHaveCount(1);
});

test('cookie settings reopen the banner from any page', async ({ page }) => {
    await page.goto('/privacy.html');
    await page.click('[data-consent="rejected"]');
    await page.getByRole('button', { name: 'Cookie Settings' }).click();
    await expect(page.locator('.consent-banner')).toBeVisible();
    await expect(page.locator('[data-consent="rejected"]')).toBeFocused();
});
