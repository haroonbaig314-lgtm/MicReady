// Installable web app: manifest, icons, service worker, offline pages.
const { test, expect } = require('@playwright/test');

test('manifest is valid and its icons exist', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.short_name).toBe('MicReady');
    expect(m.display).toBe('standalone');
    expect(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons) {
        const r = await request.get('/' + icon.src);
        expect(r.status(), icon.src).toBe(200);
        const b = await r.body();
        expect(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`).toBe(icon.sizes);
    }
});

test('service worker takes control and pages open offline', async ({ page, context }) => {
    await page.goto('/index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.goto('/privacy.html');
    await expect(page).toHaveTitle('Privacy Policy | MicReady');
    await page.goto('/index.html?sweep=1');
    await expect(page.locator('#micButton')).toBeVisible();
    await context.setOffline(false);
});
