// Voice profiles: consent, recording voices, recognizing the speaker, ignoring or tracking other voices.
// Uses real recordings (LibriSpeech, see tests/fixtures/README.md) played through Chromium's fake microphone.
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const { FAKE_SPEECH, rejectConsent } = require('./helpers');
const V = require('../voiceid.js');

const fixture = name => path.join(__dirname, 'fixtures', name);

// Runs fn(page) in a fresh browser whose microphone plays the given file, carrying over local storage.
async function withMic(testInfo, wav, storageState, fn) {
    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM || undefined,
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav]
    });
    try {
        const context = await browser.newContext({ permissions: ['microphone'], storageState, baseURL: testInfo.project.use.baseURL || 'http://127.0.0.1:4173' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(FAKE_SPEECH);
        await page.goto('/mvp.html');
        await rejectConsent(page);
        await fn(page);
        expect(errors).toEqual([]);
        return await context.storageState();
    } finally {
        await browser.close();
    }
}

async function recordVoice(page, row) {
    await page.locator('#voiceList li').nth(row).getByRole('button', { name: /Record/ }).click();
    await expect(page.locator('#voiceEnrollOverlay')).toHaveClass(/visible/);
    await page.click('#enrollStart');
    // The bar fills within one reading of the passage (about 12 s of speech here), not 50 s.
    const started = Date.now();
    await page.waitForFunction(() => document.getElementById('voiceEnrollOverlay').getAttribute('data-stage') !== 'recording', null, { timeout: 60000, polling: 100 });
    expect(Date.now() - started).toBeLessThan(20000);
    await expect(page.locator('#enrollDone')).toBeVisible({ timeout: 150000 });
    await expect(page.locator('#enrollStatus')).toContainText('Saved');
    await page.click('#enrollDone');
}

async function startSession(page) {
    await page.locator('#micButton').click({ force: true });
    const confirm = page.locator('#disclaimerConfirm');
    if (await confirm.isVisible()) await confirm.click();
}

test('the feature extraction matches Kaldi filterbanks', () => {
    // A tone sweep with a little noise; reference values from kaldi-native-fbank (high_freq -400, snip_edges false).
    const x = new Float32Array(16000);
    let seed = 7;
    for (let i = 0; i < x.length; i++) {
        seed = (seed * 16807) % 2147483647;
        x[i] = 0.3 * Math.sin(2 * Math.PI * (200 + 1800 * i / 16000) * i / 16000) + 0.01 * (seed / 2147483647 - 0.5);
    }
    const fb = V.fbank(x);
    expect(fb.frames).toBe(100);
    const REF = require('./fixtures/fbank-ref.json');
    let maxDiff = 0;
    REF.frames.forEach((row, f) => row.forEach((v, k) => { maxDiff = Math.max(maxDiff, Math.abs(fb.data[REF.index[f] * 80 + k] - v)); }));
    expect(maxDiff).toBeLessThan(0.01);
});

test('a voiceprint from the earlier recognition is deleted and the person is asked to record again', async ({ page }) => {
    await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('micready_voice', JSON.stringify({ consent: true, at: 1, mode: 'solo', autoSwitch: true }));
        localStorage.setItem('micready_voiceprints', JSON.stringify({ default: { v: new Array(256).fill(0.0625), at: 1, secs: 20 } }));
    });
    await page.addInitScript(FAKE_SPEECH);
    await page.goto('/mvp.html');
    await rejectConsent(page);
    await expect(page.locator('#voiceList li').first()).toContainText('please record again');
    await expect(page.locator('#voiceList li').first().getByRole('button', { name: 'Record again' })).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('micready_voiceprints')));
    expect(stored.default.outdated).toBe(true);
    expect(stored.default.v).toBeUndefined();
    expect(await page.evaluate(() => window.MicReadyVoice.enrolled())).toEqual([]);
});

test('voice profiles: consent, two voices, automatic switching, ignoring other voices, group practice', async ({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop');
    test.setTimeout(600000);

    // 1. Consent is required, then "Me" records voice A.
    let state = await withMic(testInfo, fixture('voice-a-enroll.wav'), undefined, async page => {
        await expect(page.locator('#voiceBody')).toBeHidden();
        await page.click('#voiceSetupBtn');
        await expect(page.locator('#voiceConsentOk')).toBeDisabled();
        await page.check('#voiceConsentAgree');
        await page.click('#voiceConsentOk');
        await expect(page.locator('#voiceBody')).toBeVisible();
        await recordVoice(page, 0);
        await expect(page.locator('#voiceList li').first()).toContainText('voice saved');
    });

    // 2. A second person, Sam, records voice B.
    state = await withMic(testInfo, fixture('voice-b-enroll.wav'), state, async page => {
        await page.click('#profileAddBtn');
        await page.fill('#profileName', 'Sam');
        await page.click('#profileForm button[type=submit]');
        await recordVoice(page, 1);
        await expect(page.locator('#voiceList li').nth(1)).toContainText('Sam: voice saved');
        await page.selectOption('#profileSelect', { label: 'Me' });
    });

    // 3. Sam starts talking while "Me" is selected: MicReady switches to Sam.
    state = await withMic(testInfo, fixture('voice-b-talk.wav'), state, async page => {
        await expect(page.locator('#profileSelect')).toHaveValue('default');
        await startSession(page);
        await expect(page.locator('#profileSelect option:checked')).toHaveText('Sam', { timeout: 60000 });
        await expect(page.locator('#voiceStatus')).toContainText('Recognized Sam');
        await page.locator('#endSessionBtn').click({ force: true });
        await page.click('#closeModal');
    });

    // 4. "Ignore them": with switching off and "Me" active, Sam's "um"s are not counted.
    state = await withMic(testInfo, fixture('voice-b-talk.wav'), state, async page => {
        await page.selectOption('#profileSelect', { label: 'Me' });
        await page.uncheck('#voiceAutoSwitch');
        await startSession(page);
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('micready:hesitation')));
        await expect(page.locator('#transcript-final .tx-other')).toHaveCount(1, { timeout: 60000 });
        await expect(page.locator('#count-fc-hes')).toHaveText('0');
        await page.locator('#endSessionBtn').click({ force: true });
        await page.click('#closeModal');
        await page.check('#voiceAutoSwitch');
    });

    // 5. Group practice: MicReady follows who is speaking as the two take turns, and each person
    //    gets their own score, saved to their own progress.
    await withMic(testInfo, fixture('voice-ab-talk.wav'), state, async page => {
        await page.check('#voiceModeGroup');
        await startSession(page);
        await expect(page.locator('#groupLive .group-chip')).toHaveCount(2);
        await expect(page.locator('#groupLive .group-chip.speaking')).toHaveCount(1, { timeout: 60000 });
        // Wait until MicReady has followed each voice for a while (the recording repeats).
        await page.waitForFunction(() => {
            const secs = Array.from(document.querySelectorAll('#groupLive .group-chip'), c => {
                const m = c.textContent.match(/(\d+):(\d\d)/);
                return m ? +m[1] * 60 + +m[2] : 0;
            });
            return secs.length === 2 && secs.every(x => x >= 7);
        }, null, { timeout: 120000 });
        await page.locator('#endSessionBtn').click({ force: true });
        await expect(page.locator('#groupResults')).toBeVisible();
        expect((await page.locator('#groupCards .group-name').allTextContents()).sort()).toEqual(['Me', 'Sam']);
        for (const score of await page.locator('#groupCards .group-score').allTextContents()) expect(score).toMatch(/^\d+$/);
        await expect(page.locator('#saveProgressText')).toHaveText('Save each person\u2019s results to their own progress');
        await page.check('#saveProgress');
        const saved = await page.evaluate(() => {
            const P = window.MicReadyProfiles;
            return P.list().map(p => p.name + ' ' + JSON.parse(localStorage.getItem(P.historyKey(p.id)) || '[]').length);
        });
        expect(saved.sort()).toEqual(['Me 1', 'Sam 1']);
        // Deleting all voice data turns the feature off.
        await page.click('#closeModal');
        page.once('dialog', d => d.accept());
        await page.click('#voiceDeleteAll');
        await expect(page.locator('#voiceSetup')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('micready_voiceprints'))).toBeNull();
    });
});
