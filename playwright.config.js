// Automated checks for the MicReady site. Run with: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const S = require('./tests/synth');

const PORT = 4173;
// Lets a machine with a preinstalled Chromium point Playwright at it.
const executablePath = process.env.PW_CHROMIUM || undefined;
// The fake microphone plays a quiet, steady hiss: the page's signal check hears it, and the
// sound analysis never takes it for speech. Chromium's own test sound is a beep every 0.5 s
// with 0.45 s of silence between, just under the 0.5 s shortest pause; on a busy machine the
// beeps arrive unevenly and the longer gaps were counted as pauses the tests never made.
const QUIET_ROOM = path.join(os.tmpdir(), 'micready-quiet-room.wav');
const tmp = QUIET_ROOM + '.' + process.pid;
fs.writeFileSync(tmp, S.toWav(S.noise(16000, 2, 0.0005, 3), 16000));
fs.renameSync(tmp, QUIET_ROOM);
const chromiumArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=' + QUIET_ROOM, '--autoplay-policy=no-user-gesture-required'];

module.exports = defineConfig({
    testDir: './tests',
    testMatch: /.*\.spec\.js/,
    timeout: 45000,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        permissions: ['microphone'],
        launchOptions: { executablePath, args: chromiumArgs },
        trace: 'retain-on-failure'
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
        { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ }
    ],
    webServer: {
        command: `node tests/serve.js ${PORT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI
    }
});
