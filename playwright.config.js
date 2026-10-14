// Automated checks for the MicReady site. Run with: npm test
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;
// Lets a machine with a preinstalled Chromium point Playwright at it.
const executablePath = process.env.PW_CHROMIUM || undefined;
const chromiumArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

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
