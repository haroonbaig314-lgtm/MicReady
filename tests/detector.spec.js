// The on-device "um"/"uh" and pause detector (hesitation.js), on synthetic audio.
const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const S = require('./synth');
const Detector = require('../hesitation.js');

function run(x, fs_) {
    const d = new Detector(fs_), hits = [], pauses = [];
    d.onDetect = t => hits.push(t);
    d.onPause = (s, t) => pauses.push([s, t]);
    for (let i = 0; i < x.length; i += 128) d.process(x.subarray(i, i + 128));
    return { hits, pauses };
}

for (const rate of [48000, 44100, 16000]) {
    test.describe(`at ${rate} Hz`, () => {
        const lead = S.silence(rate, 0.5);

        test('a held "uh" between normal syllables is reported once, while it is happening', () => {
            const before = S.concat([lead, S.syllables(rate, 6)]);
            const x = S.concat([before, S.vowel(rate, 0.6, 115, S.SCHWA, 0.4), S.syllables(rate, 6, 7), S.silence(rate, 0.4)]);
            const { hits } = run(x, rate);
            const start = before.length / rate;
            expect(hits).toHaveLength(1);
            expect(hits[0]).toBeGreaterThan(start + 0.25);
            expect(hits[0]).toBeLessThan(start + 0.6);
        });

        test('fluent syllables, noise and a sliding pitch are not reported', () => {
            expect(run(S.concat([lead, S.syllables(rate, 40, 11)]), rate).hits).toEqual([]);
            expect(run(S.concat([lead, S.noise(rate, 3, 0.2)]), rate).hits).toEqual([]);
            expect(run(S.concat([lead, S.vowel(rate, 0.8, t => 110 + 160 * t, S.SCHWA, 0.4)]), rate).hits).toEqual([]);
        });

        test('pauses of 0.5 s or more are measured; short gaps are not', () => {
            const x = S.addNoise(S.concat([lead, S.syllables(rate, 5), S.silence(rate, 0.8), S.syllables(rate, 5, 5),
                S.silence(rate, 0.3), S.syllables(rate, 5, 9), S.silence(rate, 3.5), S.syllables(rate, 4, 13)]), 0.0005, 3);
            const { pauses } = run(x, rate);
            expect(pauses).toHaveLength(2);
            expect(pauses[0][0]).toBeCloseTo(0.8, 1);
            expect(pauses[1][0]).toBeCloseTo(3.5, 1);
        });
    });
}

test('in the browser, the AudioWorklet hears a held "uh" from the microphone', async ({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop');
    const rate = 48000;
    const x = S.concat([S.silence(rate, 1.5), S.syllables(rate, 6), S.vowel(rate, 0.7, 115, S.SCHWA, 0.4), S.syllables(rate, 6, 7), S.silence(rate, 2)]);
    const wav = testInfo.outputPath('uh.wav');
    fs.writeFileSync(wav, S.toWav(x, rate));
    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM || undefined,
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav]
    });
    try {
        const context = await browser.newContext({ permissions: ['microphone'], baseURL: testInfo.project.use.baseURL || 'http://127.0.0.1:4173' });
        const page = await context.newPage();
        await page.addInitScript(require('./helpers').FAKE_SPEECH);
        await page.goto('/index.html');
        await page.click('[data-consent="rejected"]');
        await page.evaluate(() => { window.__hits = 0; document.addEventListener('verba:hesitation', () => window.__hits++); });
        await page.locator('#micButton').click({ force: true });
        await page.click('#disclaimerConfirm');
        await expect.poll(() => page.evaluate(() => window.__hits), { timeout: 15000 }).toBeGreaterThan(0);
        await expect(page.locator('#count-fc-hes')).not.toHaveText('0');
    } finally {
        await browser.close();
    }
});
