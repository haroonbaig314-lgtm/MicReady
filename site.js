/* MicReady: cookie and third-party content consent.
 *
 * The site sets no advertising or analytics cookies. The only optional item is the
 * beehiiv newsletter form, which is loaded from beehiiv's servers and may set its own
 * cookies. It loads only after the visitor allows it. The choice is stored in
 * localStorage under "micready_consent" ("accepted" or "rejected").
 */
(function () {
    // Settings and saved practice from before the rename to MicReady move to the new storage
    // names the first time a page loads, so nothing a visitor saved is lost.
    var OLD = 'verba_';
    try {
        var moved = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(OLD) === 0) moved.push(k);
        }
        moved.forEach(function (k) {
            var to = 'micready_' + k.slice(OLD.length);
            if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k));
            localStorage.removeItem(k);
        });
        // The page chose its theme before this ran, so apply a moved dark-mode choice now.
        if (moved.indexOf(OLD + 'theme') !== -1 && localStorage.getItem('micready_theme') === 'dark') {
            var dark = document.getElementById('darkCss');
            if (dark) dark.media = 'all';
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    } catch (e) {}

    var KEY = 'micready_consent';

    function getChoice() {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }
    function saveChoice(v) {
        try { localStorage.setItem(KEY, v); } catch (e) {}
    }

    // ── Third-party embeds (elements with data-consent-embed) ──
    function loadEmbeds() {
        var slots = document.querySelectorAll('[data-consent-embed]');
        Array.prototype.forEach.call(slots, function (slot) {
            if (slot.getAttribute('data-loaded') === '1') return;
            slot.setAttribute('data-loaded', '1');
            var iframe = document.createElement('iframe');
            iframe.src = slot.getAttribute('data-src');
            iframe.title = slot.getAttribute('data-title') || 'Embedded content';
            iframe.className = slot.getAttribute('data-class') || '';
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('scrolling', 'no');
            iframe.setAttribute('loading', 'lazy');
            iframe.style.cssText = slot.getAttribute('data-style') || '';
            var script = slot.getAttribute('data-script');
            slot.innerHTML = '';
            slot.appendChild(iframe);
            if (script && !document.querySelector('script[src="' + script + '"]')) {
                var s = document.createElement('script');
                s.async = true;
                s.src = script;
                document.body.appendChild(s);
            }
        });
    }
    function unloadEmbeds() {
        // Reload so any embed already running is removed from the page.
        var slots = document.querySelectorAll('[data-consent-embed][data-loaded="1"]');
        if (slots.length) window.location.reload();
    }

    // ── Banner ──
    var banner = null;
    var lastFocus = null;

    function buildBanner() {
        banner = document.createElement('div');
        banner.className = 'consent-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-modal', 'false');
        banner.setAttribute('aria-labelledby', 'consentTitle');
        banner.setAttribute('aria-describedby', 'consentDesc');
        banner.hidden = true;
        banner.innerHTML =
            '<h2 id="consentTitle">Cookies and third-party content</h2>' +
            '<p id="consentDesc">MicReady uses no advertising or analytics cookies. Your browser\'s local storage remembers this choice and whether you have seen the demo notice. ' +
            'If you allow it, we also load our newsletter signup form from beehiiv, which may set its own cookies. ' +
            'See our <a href="cookies.html">Cookie Policy</a> and <a href="privacy.html">Privacy Policy</a>.</p>' +
            '<div class="consent-actions">' +
            '<button type="button" data-consent="rejected">Reject optional</button>' +
            '<button type="button" data-consent="accepted">Accept optional</button>' +
            '</div>';
        document.body.appendChild(banner);
        banner.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-consent]');
            if (!btn) return;
            setChoice(btn.getAttribute('data-consent'));
        });
        banner.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && getChoice()) hideBanner();
        });
    }
    function showBanner(moveFocus) {
        if (!banner) buildBanner();
        lastFocus = document.activeElement;
        banner.hidden = false;
        var first = banner.querySelector('button');
        if (moveFocus && first) first.focus({ preventScroll: true });
    }
    function hideBanner() {
        if (!banner) return;
        banner.hidden = true;
        if (lastFocus && lastFocus.focus && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
    }

    function setChoice(v) {
        var prev = getChoice();
        saveChoice(v);
        hideBanner();
        if (v === 'accepted') loadEmbeds();
        else if (prev === 'accepted') unloadEmbeds();
    }

    // ── Light / dark theme ──
    // The site opens light. The header button switches to dark and remembers it.
    var THEME_KEY = 'micready_theme';
    var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
    var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>';
    var themeBtn = null;

    function isDark() {
        var link = document.getElementById('darkCss');
        return !!link && link.media === 'all';
    }
    function renderThemeButton() {
        if (!themeBtn) return;
        var dark = isDark();
        themeBtn.innerHTML = dark ? SUN : MOON;
        themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    function setTheme(theme) {
        var link = document.getElementById('darkCss');
        if (link) link.media = theme === 'dark' ? 'all' : 'not all';
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
        renderThemeButton();
        document.dispatchEvent(new CustomEvent('micready:theme', { detail: { theme: theme } }));
    }
    function addThemeButton() {
        var nav = document.querySelector('header nav');
        if (!nav || !document.getElementById('darkCss')) return;
        themeBtn = document.createElement('button');
        themeBtn.type = 'button';
        themeBtn.className = 'theme-toggle';
        themeBtn.setAttribute('aria-label', 'Dark mode');
        themeBtn.addEventListener('click', function () { setTheme(isDark() ? 'light' : 'dark'); });
        var holder = nav.querySelector('.nav-links');
        if (!holder) {
            // Legal pages: keep the "Back to home" link and the button together on the right.
            holder = document.createElement('div');
            holder.className = 'nav-actions';
            var lastLink = nav.lastElementChild;
            if (lastLink && lastLink.tagName === 'A' && !lastLink.classList.contains('logo')) holder.appendChild(lastLink);
            nav.appendChild(holder);
        }
        holder.appendChild(themeBtn);
        renderThemeButton();
    }

    window.MicReadyConsent = {
        get: getChoice,
        set: setChoice,
        open: function () { showBanner(true); }
    };

    function init() {
        addThemeButton();
        document.addEventListener('click', function (e) {
            if (e.target.closest('[data-open-consent]')) { e.preventDefault(); showBanner(true); }
            var allow = e.target.closest('[data-allow-embed]');
            if (allow) { e.preventDefault(); setChoice('accepted'); }
        });
        var choice = getChoice();
        if (choice === 'accepted') loadEmbeds();
        else if (!choice) showBanner(false);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // Offline support and "add to home screen" (sw.js). HTTPS or localhost only.
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () {});
        });
    }
}());
