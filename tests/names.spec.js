// Profile names: swear words, slurs and other offensive words are refused (namecheck.js).
// The words come from the filter's own list (obscenity), so this file does not spell them out.
const { test, expect } = require('@playwright/test');
const { openMvp } = require('./helpers');
const C = require('../namecheck.js');
const O = require('../vendor/obscenity/obscenity.min.js');

const listed = O.englishDataset.containers.map(c => c.metadata && c.metadata.originalWord).filter(Boolean);
const disguises = {
    'as typed': w => w,
    'in capitals': w => w.toUpperCase(),
    'with dots between the letters': w => w.split('').join('.'),
    'with spaces between the letters': w => w.split('').join(' '),
    'with a letter typed four times': w => w.replace(/([a-z])/, '$1$1$1$1'),
    'with digits for letters': w => w.replace(/a/g, '4').replace(/e/g, '3').replace(/i/g, '1').replace(/o/g, '0').replace(/s/g, '5'),
    'after a first name': w => 'Sam ' + w,
    'with invisible characters between the letters': w => w.split('').join('​'),
    'in full-width letters': w => w.replace(/[a-z]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
};

test('every word on the list is refused, as typed and in disguise', () => {
    expect(listed.length).toBeGreaterThan(50);
    for (const [how, f] of Object.entries(disguises)) {
        const missed = listed.filter(w => C.allowed(f(w)));
        expect(missed.length, how).toBe(0);
    }
});

test('real names that only contain a listed word are allowed', () => {
    const names = ['Me', 'Sam', 'Cassandra', 'Matsushita', 'Douglass', 'Hancock', 'Hitchcock', 'Dickens', 'Dickinson', 'Essex',
        'Sexton', 'Titus', 'Analise', 'Annalise', 'Nazir', 'Spicer', 'Fagan', 'Fukuda', 'Cummings', 'Kikelomo', 'Pornchai',
        'Siriporn', 'Shitara', 'Phuc', 'Jean-Luc', 'José García', 'Zoë', 'Nguyễn Văn An', 'Mary Ann', 'Sam Cummings'];
    expect(names.filter(n => !C.allowed(n))).toEqual([]);
    expect(C.allowedNames().filter(n => !C.allowed(n))).toEqual([]);
});

test('Add a person and Rename refuse an offensive name and explain why', async ({ page }) => {
    await openMvp(page);
    const word = await page.evaluate(() => Obscenity.englishDataset.containers.map(c => c.metadata && c.metadata.originalWord).find(Boolean));
    // Adding a person with that name
    await page.click('#profileAddBtn');
    await page.fill('#profileName', word);
    await page.click('#profileForm button[type=submit]');
    await expect(page.locator('#profileStatus')).toContainText('Please choose a different name');
    await expect(page.locator('#profileName')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#profileSelect option')).toHaveCount(1);
    expect(await page.evaluate(w => window.VerbaProfiles.add(w), word)).toBeNull();
    await page.click('#profileCancel');
    // Renaming "Me" to it, with dots between the letters
    await page.click('#profileEditBtn');
    await page.fill('#profileName', word.split('').join('.'));
    await page.click('#profileForm button[type=submit]');
    await expect(page.locator('#profileStatus')).toContainText('Please choose a different name');
    await expect(page.locator('#profileSelect option:checked')).toHaveText('Me');
    // A real name goes through
    await page.fill('#profileName', 'Cummings');
    await expect(page.locator('#profileName')).not.toHaveAttribute('aria-invalid', 'true');
    await page.click('#profileForm button[type=submit]');
    await expect(page.locator('#profileSelect option:checked')).toHaveText('Cummings');
});
