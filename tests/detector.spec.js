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

        test('a held "umm" (vowel into a hum) and an "uhh" with a falling pitch are each reported once', () => {
            const umm = S.concat([S.vowel(rate, 0.3, 120, S.SCHWA, 0.4), S.vowel(rate, 0.6, 118, [250, 1000, 2300], 0.3)]);
            const uhh = S.vowel(rate, 0.9, t => 135 - 30 * t, S.SCHWA, 0.4);
            const x = S.addNoise(S.concat([lead, S.syllables(rate, 6), umm, S.syllables(rate, 6, 7), uhh, S.syllables(rate, 5, 9), S.silence(rate, 0.4)]), 0.0005, 5);
            expect(run(x, rate).hits).toHaveLength(2);
        });

        test('a loud, clipped "UHH" spoken right into the microphone is reported', () => {
            const loud = S.vowel(rate, 0.7, 150, S.SCHWA, 0.9).map(v => Math.max(-0.6, Math.min(0.6, v * 2)));
            const x = S.addNoise(S.concat([lead, S.syllables(rate, 4), loud, S.syllables(rate, 4, 3), S.silence(rate, 0.4)]), 0.0005, 6);
            expect(run(x, rate).hits).toHaveLength(1);
        });

        test('a stream that opens with digital silence still measures a 5-second pause', () => {
            // Microphones often deliver exact zeros while they wake up; this once left the
            // noise floor stuck so low that no silence was ever recognised.
            const speech = S.addNoise(S.concat([S.syllables(rate, 6), S.silence(rate, 5), S.syllables(rate, 6, 5), S.silence(rate, 0.3)]), 0.0005, 4);
            const { pauses } = run(S.concat([S.silence(rate, 1.2), speech]), rate);
            expect(pauses).toHaveLength(1);
            expect(pauses[0][0]).toBeCloseTo(5, 1);
        });

        test('in a quiet room noise mode never switches on', () => {
            const d = new Detector(rate); let everNoisy = false;
            const x = S.addNoise(S.concat([lead, S.syllables(rate, 30, 21), S.silence(rate, 2), S.syllables(rate, 30, 22)]), 0.0005, 9);
            for (let i = 0; i < x.length; i += 128) { d.process(x.subarray(i, i + 128)); everNoisy = everNoisy || d.noisy; }
            expect(everNoisy).toBe(false);
        });

        test('a microphone that is fully silent between sounds (a noise gate) is not taken for a noisy room', () => {
            const d = new Detector(rate); let everNoisy = false;
            const x = S.concat([lead, S.syllables(rate, 12, 51), S.silence(rate, 1.5), S.syllables(rate, 12, 52), S.silence(rate, 1.5), S.syllables(rate, 12, 53)]);
            for (let i = 0; i < x.length; i += 128) { d.process(x.subarray(i, i + 128)); everNoisy = everNoisy || d.noisy; }
            expect(everNoisy).toBe(false);
        });

        test('with loud background noise, noise mode turns on: a 3 s pause is measured, a 0.6 s gap is not, a held "uh" still counts', () => {
            // Speech about 15 dB above a steady broadband noise, like a loud fan.
            const talk = S.concat([lead, S.syllables(rate, 25, 31), S.silence(rate, 0.6), S.syllables(rate, 10, 32),
                S.silence(rate, 3), S.syllables(rate, 10, 33), S.vowel(rate, 0.7, 120, S.SCHWA, 0.4), S.syllables(rate, 8, 34), S.silence(rate, 0.5)]);
            const x = S.addNoise(talk, 0.04, 12);
            const d = new Detector(rate), hits = [], pauses = [];
            d.onDetect = t => hits.push(t);
            d.onPause = s => pauses.push(s);
            for (let i = 0; i < x.length; i += 128) d.process(x.subarray(i, i + 128));
            expect(d.noisy).toBe(true);
            expect(pauses).toHaveLength(1);
            expect(pauses[0]).toBeGreaterThan(2.6);
            expect(pauses[0]).toBeLessThan(3.3);
            expect(hits).toHaveLength(1);
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

test('in the browser, the microphone analysis finds a held "uh" and a 5-second pause and marks both', async ({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop');
    const rate = 48000;
    const talk = S.addNoise(S.concat([S.syllables(rate, 6), S.vowel(rate, 0.7, 115, S.SCHWA, 0.4), S.syllables(rate, 6, 7),
        S.silence(rate, 5), S.syllables(rate, 6, 9), S.silence(rate, 2)]), 0.0005, 8);
    const x = S.concat([S.silence(rate, 1.5), talk]);
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
        await page.evaluate(() => { window.__hits = 0; document.addEventListener('micready:hesitation', () => window.__hits++); });
        await page.locator('#micButton').click({ force: true });
        await page.click('#disclaimerConfirm');
        await expect.poll(() => page.evaluate(() => window.__hits), { timeout: 15000 }).toBeGreaterThan(0);
        await expect(page.locator('#count-fc-hes')).not.toHaveText('0');
        await expect(page.locator('#transcript-final .tx-hes').first()).toBeVisible();
        await expect(page.locator('#transcript-final .tx-pause').first()).toHaveText(/^[45]\.\d s pause$/, { timeout: 20000 });
        expect(+(await page.locator('#pauseDisplay').textContent())).toBeGreaterThan(0);
        await expect(page.locator('#micNote')).toBeHidden();
    } finally {
        await browser.close();
    }
});

test('in the browser, loud background noise switches on noise mode and says so', async ({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop');
    const rate = 48000;
    const talk = S.concat([S.syllables(rate, 25, 41), S.vowel(rate, 0.7, 115, S.SCHWA, 0.4), S.syllables(rate, 10, 42),
        S.silence(rate, 3), S.syllables(rate, 12, 43), S.silence(rate, 1)]);
    const x = S.concat([S.silence(rate, 1), S.addNoise(talk, 0.04, 14)]);
    const wav = testInfo.outputPath('noisy.wav');
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
        await expect(page.locator('#noiseNote')).toBeHidden();
        await page.locator('#micButton').click({ force: true });
        await page.click('#disclaimerConfirm');
        await expect(page.locator('#noiseNote')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#noiseNote')).toContainText('only pauses of 1 second or longer');
        await expect(page.locator('#transcript-final .tx-pause').first()).toHaveText(/^[23]\.\d s pause$/, { timeout: 20000 });
        await expect(page.locator('#micNote')).toBeHidden();
    } finally {
        await browser.close();
    }
});
