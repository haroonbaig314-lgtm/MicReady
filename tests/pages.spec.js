// Every page loads cleanly, carries its basic metadata, and fits a phone screen.
const { test, expect } = require('@playwright/test');
const { PAGES, rejectConsent, trackErrors } = require('./helpers');

for (const name of PAGES) {
    test(`${name} loads without errors and fits the screen @mobile`, async ({ page }) => {
        const errors = trackErrors(page);
        const res = await page.goto('/' + name);
        expect(res.status()).toBe(200);
        await rejectConsent(page);
        await expect(page).toHaveTitle(/Verba/);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{40,}/);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/haroonbaig314-lgtm\.github\.io\/Verba\//);
        await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
    });

    test(`${name} links to pages that exist`, async ({ page, request }) => {
        await page.goto('/' + name);
        const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
        const internal = [...new Set(hrefs.filter(h => !/^(https?:|mailto:|#)/.test(h)).map(h => h.split('#')[0]).filter(Boolean))];
        for (const href of internal) {
            const r = await request.get('/' + href);
            expect(r.status(), href).toBe(200);
        }
    });
}

test('every page has the legal footer and business details', async ({ page }) => {
    for (const name of PAGES) {
        await page.goto('/' + name);
        const footer = page.locator('footer');
        for (const label of ['Privacy Policy', 'Terms of Service', 'Refund Policy', 'Cookie Policy', 'Data Requests']) {
            await expect(footer.getByRole('link', { name: label })).toBeVisible();
        }
        await expect(footer.getByRole('button', { name: 'Cookie Settings' })).toBeVisible();
        await expect(footer).toContainText('Connecticut');
    }
});

test('home page structured data parses', async ({ page }) => {
    await page.goto('/index.html');
    const data = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    expect(data.map(d => d['@type'])).toEqual(['WebApplication', 'FAQPage']);
    const visibleQuestions = await page.locator('.faq-question-text').allTextContents();
    expect(data[1].mainEntity.map(q => q.name)).toEqual(visibleQuestions.map(q => q.trim()));
});

test('sitemap lists every page', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    for (const name of PAGES) {
        const path = name === 'index.html' ? '' : name;
        expect(xml).toContain(`<loc>https://haroonbaig314-lgtm.github.io/Verba/${path}</loc>`);
    }
});

test('the home page has a lightweight demo and Try the MVP buttons that open the full tool', async ({ page }) => {
    await page.goto('/index.html');
    await rejectConsent(page);
    await expect(page.locator('a[href*="glide.page"]')).toHaveCount(0);
    await expect(page.locator('.demo-badge')).toHaveText('Lightweight Browser Demo');
    // The hero, the call to action under the demo, and the closing section all lead to the MVP.
    const ctas = page.getByRole('link', { name: /^Try the (Verba )?MVP$/ });
    await expect(ctas).toHaveCount(3);
    for (const href of await ctas.evaluateAll(els => els.map(e => e.getAttribute('href')))) expect(href).toBe('mvp.html');
    // The full tool's extras are not on the home page.
    await expect(page.locator('#practiceWrap')).toHaveCount(0);
    await expect(page.locator('#progress')).toHaveCount(0);
    await expect(page.locator('#saveProgress')).toHaveCount(0);
    await page.locator('.hero .cta-buttons a').click();
    await expect(page).toHaveURL(/\/mvp\.html$/);
    await expect(page.locator('.demo-badge')).toHaveText('MVP');
    await expect(page.locator('#practiceWrap')).toBeVisible();
    await expect(page.locator('#progress')).toBeVisible();
    await expect(page.locator('#saveProgress')).toHaveCount(1);
});

test('the Future page links to the MVP and never to the old Glide app', async ({ page }) => {
    await page.goto('/future.html');
    await expect(page.locator('a[href*="glide.page"]')).toHaveCount(0);
    await expect(page.locator('footer a[href="mvp.html"]')).toHaveText('Try MVP');
});

