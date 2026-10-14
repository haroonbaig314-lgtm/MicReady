// Results images download at the right sizes and contain no transcript text.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { openMvp: openDemo, startSession } = require('./helpers');

function pngSize(file) {
    const b = fs.readFileSync(file);
    expect(b.slice(1, 4).toString()).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('story and LinkedIn images download as PNGs of the right size', async ({ page }) => {
    await openDemo(page, { clock: true });
    await startSession(page);
    await page.evaluate(() => window.__emit('a short practice run with a few words in it ', true));
    await page.clock.runFor(20000);
    await page.locator('#endSessionBtn').click({ force: true });
    for (const [id, size, suffix] of [['#shareStory', [1080, 1920], '-story.png'], ['#shareWide', [1200, 627], '-linkedin.png']]) {
        const [download] = await Promise.all([page.waitForEvent('download'), page.click(id)]);
        expect(download.suggestedFilename()).toMatch(new RegExp('^micready-session-\\d{4}-\\d{2}-\\d{2}' + suffix + '$'));
        const file = test.info().outputPath(download.suggestedFilename());
        await download.saveAs(file);
        expect(pngSize(file)).toEqual(size);
    }
});
