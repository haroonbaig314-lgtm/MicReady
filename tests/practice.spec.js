// Practice modes, topics and the countdown.
const { test, expect } = require('@playwright/test');
const { openMvp: openDemo, startSession } = require('./helpers');

test('choosing a timed mode shows a topic and the time limit', async ({ page }) => {
    await openDemo(page);
    await page.selectOption('#practiceMode', 'interview');
    await expect(page.locator('#practicePrompt')).toBeVisible();
    await expect(page.locator('#timer')).toHaveText('2:00');
    await expect(page.locator('#timerLabel')).toHaveText('Time left');
    const first = await page.locator('#practicePrompt').textContent();
    await page.click('#topicBtn');
    await expect(page.locator('#practicePrompt')).not.toHaveText(first);
});

test('free practice counts up and gives a topic on request', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('#practicePrompt')).toBeHidden();
    await page.click('#topicBtn');
    await expect(page.locator('#practicePrompt')).toBeVisible();
    await expect(page.locator('#timerLabel')).toHaveText('Duration');
});

test('a 60-second pitch counts down and ends itself', async ({ page }) => {
    test.setTimeout(120000);
    await openDemo(page, { clock: true });
    await page.selectOption('#practiceMode', 'pitch');
    await startSession(page);
    await expect(page.locator('#practiceMode')).toBeDisabled();
    await page.clock.runFor(51000);
    await expect(page.locator('#timer')).toHaveText('0:09');
    await expect(page.locator('#timer')).toHaveClass(/timer-low/);
    await page.clock.runFor(10000);
    await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#summaryDuration')).toHaveText('1:00');
});
