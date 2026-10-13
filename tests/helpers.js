// Shared test helpers.

// Browsers' speech recognition needs Google's servers, so tests replace it with a
// stand-in that the test drives: window.__emit(text, isFinal).
const FAKE_SPEECH = `(() => {
    function FakeRecognition() { window.__recognition = this; }
    FakeRecognition.prototype.start = function () { const s = this; setTimeout(() => s.onstart && s.onstart(), 0); };
    FakeRecognition.prototype.stop = function () { const s = this; setTimeout(() => s.onend && s.onend(), 0); };
    window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition;
    window.__emit = (text, isFinal) => {
        const alt = [{ transcript: text }]; alt.isFinal = isFinal;
        window.__recognition.onresult({ resultIndex: 0, results: [alt] });
    };
})();`;

const PAGES = ['index.html', 'future.html', 'privacy.html', 'terms.html', 'refund.html', 'cookies.html', 'data-request.html'];

async function rejectConsent(page) {
    const btn = page.locator('[data-consent="rejected"]');
    if (await btn.isVisible()) await btn.click();
}

// Opens the home page with the fake speech engine, past the cookie banner.
async function openDemo(page, { clock = false } = {}) {
    await page.addInitScript(FAKE_SPEECH);
    if (clock) await page.clock.install();
    await page.goto('/index.html');
    await rejectConsent(page);
}

async function startSession(page) {
    await page.locator('#micButton').click({ force: true });
    const confirm = page.locator('#disclaimerConfirm');
    if (await confirm.isVisible()) await confirm.click();
    await page.waitForFunction(() => document.getElementById('demoCard').classList.contains('recording'));
}

function counters(page) {
    return page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.filler-counter-card'))
        .map(c => [c.querySelector('.filler-counter-label').textContent, +c.querySelector('.filler-counter-number').textContent])));
}

// Collects console errors and uncaught exceptions for a page.
function trackErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    return errors;
}

module.exports = { FAKE_SPEECH, PAGES, rejectConsent, openDemo, startSession, counters, trackErrors };
