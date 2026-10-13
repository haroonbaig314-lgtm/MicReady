/* Verba: cookie and third-party content consent.
 *
 * The site sets no advertising or analytics cookies. The only optional item is the
 * beehiiv newsletter form, which is loaded from beehiiv's servers and may set its own
 * cookies. It loads only after the visitor allows it. The choice is stored in
 * localStorage under "verba_consent" ("accepted" or "rejected").
 */
(function () {
    var KEY = 'verba_consent';

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
            '<p id="consentDesc">Verba uses no advertising or analytics cookies. Your browser\'s local storage remembers this choice and whether you have seen the demo notice. ' +
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

    window.VerbaConsent = {
        get: getChoice,
        set: setChoice,
        open: function () { showBanner(true); }
    };

    function init() {
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
