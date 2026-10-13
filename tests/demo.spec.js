// The live demo: counting, highlighting, de-duplication, hedges, pauses, summary.
const { test, expect } = require('@playwright/test');
const { openDemo, startSession, counters } = require('./helpers');

const hesitation = page => page.evaluate(() => document.dispatchEvent(new CustomEvent('verba:hesitation')));
const pause = (page, s) => page.evaluate(d => document.dispatchEvent(new CustomEvent('verba:pause', { detail: { duration: d } })), s);
const say = (page, text, isFinal = true) => page.evaluate(([t, f]) => window.__emit(t, f), [text, isFinal]);

test('first mic press shows the privacy notice; Escape closes it', async ({ page }) => {
    await openDemo(page);
    await page.locator('#micButton').click({ force: true });
    await expect(page.locator('#disclaimerOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#disclaimerConfirm')).toBeFocused();
    await expect(page.locator('#disclaimerOverlay')).toContainText('does not record, save, or send your audio');
    await page.keyboard.press('Escape');
    await expect(page.locator('#disclaimerOverlay')).not.toHaveClass(/visible/);
});

test('sound-based "um" and a later transcript "um" count once', async ({ page }) => {
    await openDemo(page);
    await startSession(page);
    await hesitation(page);
    await say(page, 'so um I was thinking ');
    expect((await counters(page))['UM / UH']).toBe(1);
    await say(page, 'uh okay ');                       // no sound detection to match: counts
    expect((await counters(page))['UM / UH']).toBe(2);
    await say(page, 'a humble umbrella under the hut '); // contains "um"/"uh" inside words: ignored
    expect((await counters(page))['UM / UH']).toBe(2);
});

test('hedges get their own counter and highlight; "feel like" is not a filler', async ({ page }) => {
    await openDemo(page);
    await startSession(page);
    await say(page, 'I think we should just try it, kind of like a test. I feel like it works ');
    const c = await counters(page);
    expect(c.HEDGES).toBe(4);   // I think, just, kind of, I feel like
    expect(c.LIKE).toBe(1);     // "kind of like" counts; "feel like" does not
    const hedges = await page.locator('#transcript-final .hedge-highlight').allTextContents();
    expect(hedges).toEqual(['I think', 'just', 'kind of', 'I feel like']);
    await expect(page.locator('#transcript-final .filler-highlight')).toHaveText(['like']);
});

test('transcript text is escaped, not rendered as HTML', async ({ page }) => {
    await openDemo(page);
    await startSession(page);
    await say(page, 'look <img src=x onerror=alert(1)> here ');
    await expect(page.locator('#transcript-final img')).toHaveCount(0);
    await expect(page.locator('#transcript-final')).toContainText('<img src=x');
});

test('German "halt" is not matched inside "Verhalten"', async ({ page }) => {
    await openDemo(page);
    await page.selectOption('#langSelect', 'de-DE');
    await startSession(page);
    await say(page, 'Das Verhalten ist halt gut, äh, genau ');
    const c = await counters(page);
    expect(c.HALT).toBe(1);
    expect(c['ÄH / ÄHM']).toBe(1);
    expect(c.GENAU).toBe(1);
});

test('pauses are counted live and long ones are called out in the summary', async ({ page }) => {
    await openDemo(page, { clock: true });
    await startSession(page);
    await page.clock.runFor(5000);
    await pause(page, 0.8);
    await pause(page, 3.4);
    await expect(page.locator('#pauseDisplay')).toHaveText('2');
    await say(page, 'this is a longer practice answer with plenty of words so that the summary has enough to work with today ');
    await page.clock.runFor(30000);
    await page.locator('#endSessionBtn').click({ force: true });
    await expect(page.locator('#summaryPauses')).toHaveText('2');
    await expect(page.locator('#coachingNote')).toContainText('You paused 2 times');
    await expect(page.locator('#coachingNote')).toContainText('ran past 3 seconds');
});

test('a pause that spans a manual pause of the session is ignored', async ({ page }) => {
    await openDemo(page, { clock: true });
    await startSession(page);
    await page.clock.runFor(1000);
    await pause(page, 5);   // longer than the time since listening started
    await expect(page.locator('#pauseDisplay')).toHaveText('0');
});

test('summary dialog: focus, Escape, honest no-filler note, repeated words', async ({ page }) => {
    await openDemo(page, { clock: true });
    await startSession(page);
    await say(page, 'basically the plan is simple. basically we build it, basically we test it, and basically we ship it on time for everyone ');
    await page.clock.runFor(35000);
    await page.locator('#endSessionBtn').click({ force: true });
    await page.clock.runFor(1000);
    await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#summaryTitle')).toBeFocused();
    await expect(page.locator('#coachingNote')).toContainText('No filler words were detected this session. Detection is an estimate');
    await expect(page.locator('#repeatList li')).toHaveCount(1);
    await expect(page.locator('#repeatList li')).toHaveText('\u201cbasically\u201d 4 times');
    await expect(page.locator('#repeatList button')).toHaveCount(0);
});

test('there is no custom word tracker', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('#customWordInput')).toHaveCount(0);
    await expect(page.getByText('Track a custom word')).toHaveCount(0);
});

test('Escape closes the summary and resets the demo', async ({ page }) => {
    await openDemo(page);
    await startSession(page);
    await page.locator('#endSessionBtn').click({ force: true });
    await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/visible/);
    await expect(page.locator('#timer')).toHaveText('0:00');
});

test('demo controls work on a phone @mobile', async ({ page }) => {
    await openDemo(page);
    await startSession(page);
    await hesitation(page);
    await say(page, 'like um this ');
    const c = await counters(page);
    expect(c['UM / UH']).toBe(1);
    expect(c.LIKE).toBe(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
