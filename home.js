/* Verba home page: demo, animations, and page interactions.
   Moved out of index.html so browsers can cache it. Loaded with defer. */

(function () {
    // ── Language config ──
    // fillers: words found in the speech-recognition transcript.
    // hes: hesitation sounds ("um", "uh") that recognizers usually drop. They are counted
    // from the microphone signal (hesitation.js) and, when a transcript does include
    // them, matched against those sound detections so nothing is counted twice.
    var LANG_CONFIG = {
        'en-US': { fillers: ['like'], labels: ['LIKE'],
                   hes: ['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm'], hesLabel: 'UM / UH' },
        'es-ES': { fillers: ['este', 'bueno', 'o sea', 'pues'], labels: ['ESTE', 'BUENO', 'O SEA', 'PUES'],
                   hes: ['eh', 'ehh', 'em', 'mmm'], hesLabel: 'EH / EM' },
        'fr-FR': { fillers: ['bah', 'genre', 'voila'], labels: ['BAH', 'GENRE', 'VOILA'],
                   hes: ['euh', 'heu'], hesLabel: 'EUH' },
        'zh-CN': { fillers: ['那个', '就是', '然后'], labels: ['那个', '就是', '然后'],
                   hes: ['嗯', '呃'], hesLabel: '嗯 / 呃' },
        'de-DE': { fillers: ['halt', 'eigentlich', 'genau'], labels: ['HALT', 'EIGENTLICH', 'GENAU'],
                   hes: ['ähm', 'äh', 'öhm'], hesLabel: 'ÄH / ÄHM' },
        'ja-JP': { fillers: ['まあ', 'なんか'], labels: ['まあ', 'なんか'],
                   hes: ['えーと', 'えっと', 'えー'], hesLabel: 'えー / えーと' },
        'ar-SA': { fillers: ['يعني', 'صح', 'طيب'], labels: ['يعني', 'صح', 'طيب'],
                   hes: ['اممم', 'امم'], hesLabel: 'اممم' },
        'hi-IN': { fillers: ['मतलब', 'बस', 'तो'], labels: ['मतलब', 'बस', 'तो'],
                   hes: ['उम', 'अं'], hesLabel: 'उम' },
        'ko-KR': { fillers: ['그', '뭐', '그니까'], labels: ['그', '뭐', '그니까'],
                   hes: ['어', '음'], hesLabel: '어 / 음' },
        'it-IT': { fillers: ['allora', 'cioè', 'tipo', 'ecco'], labels: ['ALLORA', 'CIOÈ', 'TIPO', 'ECCO'],
                   hes: ['ehm', 'eh', 'mmm'], hesLabel: 'EHM' },
        'ru-RU': { fillers: ['ну', 'это', 'как бы', 'вот'], labels: ['НУ', 'ЭТО', 'КАК БЫ', 'ВОТ'],
                   hes: ['э', 'ээ', 'эм', 'мм'], hesLabel: 'Э / ЭМ' }
    };
    var HES = '__hes';          // counter key for hesitation sounds
    var currentLang = 'en-US';
    // ── Filler list (multi-word first, then single-word) ──
    var FILLERS = LANG_CONFIG[currentLang].fillers.slice();

    // ── State ──
    var isRecording = false;
    var sessionActive = false;
    var recognition = null;
    var timerInterval = null;
    var sessionDuration = 0;
    var accumulatedTranscript = '';
    var fillerCounts = {};
    function resetCounts() {
        fillerCounts = {};
        fillerCounts[HES] = 0;
        FILLERS.forEach(function (f) { fillerCounts[f] = 0; });
        pendingSoundHits = [];
    }
    function counterKeys() { return [HES].concat(FILLERS); }
    resetCounts();
    var dotsEl = document.getElementById('typingDots');
    var typingDotsTimer = null;
    var lastActivityTime = 0;
    var watchdogInterval = null;
    var isRestarting = false;
    var customWord = '';        // normalized lowercase custom word active in current session
    var customWordLabel = '';   // display label (uppercased) for the counter tile
    var buzzerAC = null;
    var pendingSoundHits = [];  // times of sound-based detections not yet matched to transcript words

    // ── Build filler counter cards ──
    var counterContainer = document.getElementById('fillerCounters');
    function buildCounterCards() {
        counterContainer.innerHTML = '';
        var cfg = LANG_CONFIG[currentLang];
        var hesCard = document.createElement('div');
        hesCard.className = 'filler-counter-card';
        hesCard.id = 'card-fc-hes';
        hesCard.title = 'Estimated from the sound of your voice, on your device';
        hesCard.innerHTML =
            '<div class="filler-counter-number" id="count-fc-hes">0</div>' +
            '<div class="filler-counter-label">' + cfg.hesLabel + '</div>' +
            '<div class="filler-counter-est">by sound, est.</div>';
        counterContainer.appendChild(hesCard);
        FILLERS.forEach(function (filler, i) {
            var id = 'fc-' + i;
            var card = document.createElement('div');
            card.className = 'filler-counter-card';
            card.id = 'card-' + id;
            var label = (customWord && filler === customWord) ? customWordLabel : (cfg.labels[i] || filler.toUpperCase());
            card.innerHTML =
                '<div class="filler-counter-number" id="count-' + id + '">0</div>' +
                '<div class="filler-counter-label">' + label + '</div>';
            counterContainer.appendChild(card);
        });
    }
    buildCounterCards();

    // ── Speech Recognition ──
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Show unsupported message on browsers that lack the Web Speech API
    if (!SR) {
        document.getElementById('micButton').style.display = 'none';
        document.getElementById('buttonLabel').style.display = 'none';
        document.getElementById('browserUnsupported').style.display = 'block';
    }

    if (SR) {
        recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = function () {
            lastActivityTime = Date.now();
            setStatusDot('listening');
        };

        recognition.onresult = function (event) {
            lastActivityTime = Date.now();
            var newFinal = '';
            var interim = '';
            for (var i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    newFinal += event.results[i][0].transcript + ' ';
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            var hesFromText = false;
            if (newFinal) {
                accumulatedTranscript += newFinal;
                var heard = countHesWords(newFinal);
                for (var h = 0; h < heard; h++) {
                    if (!claimSoundHit()) { fillerCounts[HES]++; hesFromText = true; }
                }
            }

            var fullText = accumulatedTranscript + interim;
            var newCounts = countFillers(fullText);

            var detected = false;
            var incremented = [];
            FILLERS.forEach(function (f) {
                if (newCounts[f] > fillerCounts[f]) {
                    detected = true;
                    incremented.push(f);
                }
                fillerCounts[f] = newCounts[f];
            });

            if (detected || hesFromText) {
                triggerFillerAlert();
            }
            if (hesFromText) popCounter(HES);
            incremented.forEach(function (f) { popCounter(f); });

            renderTranscript(accumulatedTranscript, interim);
            renderCounters();
            renderWPM();
        };

        recognition.onerror = function (e) {
            if (e.error !== 'no-speech' && e.error !== 'audio-capture') {
                console.warn('Speech recognition error:', e.error);
            }
        };

        recognition.onend = function () {
            if (!isRecording) return;
            // Restart with 300ms delay; show yellow dot while gap exists
            setStatusDot('restarting');
            isRestarting = true;
            setTimeout(function () {
                isRestarting = false;
                if (isRecording) {
                    try { recognition.start(); } catch (e) {}
                }
            }, 300);
        };
    }

    // ── Hesitation sounds ──
    // Sound-based detections arrive from the microphone analysis (see the mic meter script).
    document.addEventListener('verba:hesitation', function () {
        if (!isRecording) return;
        pendingSoundHits.push(Date.now());
        fillerCounts[HES]++;
        triggerFillerAlert();
        popCounter(HES);
        renderCounters();
    });

    // A transcript "um" that arrives within a few seconds of a sound detection is the same event.
    function claimSoundHit() {
        var now = Date.now();
        pendingSoundHits = pendingSoundHits.filter(function (t) { return now - t < 6000; });
        if (!pendingSoundHits.length) return false;
        pendingSoundHits.shift();
        return true;
    }

    function isUnspacedLang() { return currentLang === 'zh-CN' || currentLang === 'ja-JP'; }

    // Whole-word match for hesitation words (substring match for Chinese and Japanese).
    function hesRegex(word) {
        var esc = word.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        if (isUnspacedLang()) return new RegExp(esc, 'g');
        try { return new RegExp('(^|[^\\p{L}\\p{N}])' + esc + '(?=[^\\p{L}\\p{N}]|$)', 'giu'); }
        catch (e) { return new RegExp('(^|\\W)' + esc + '(?=\\W|$)', 'gi'); }
    }

    function countHesWords(text) {
        var n = 0;
        LANG_CONFIG[currentLang].hes.forEach(function (w) {
            var m = text.match(hesRegex(w));
            if (m) n += m.length;
        });
        return n;
    }

    // ── Filler counting ──
    function isNonLatin(fillers) {
        return /[^\u0000-\u007F]/.test(fillers.join(''));
    }

    function fillerRegex(filler, nonLatin) {
        if (nonLatin) {
            return new RegExp(filler.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g');
        }
        var escaped = filler.replace(/\s+/g, '\\s+');
        return new RegExp('\\b' + escaped + '\\b', 'gi');
    }

    function countFillers(text) {
        var counts = {};
        FILLERS.forEach(function (filler) {
            var nonLatin = isNonLatin([filler]);
            var m = (nonLatin ? text : text.toLowerCase()).match(fillerRegex(filler, nonLatin));
            counts[filler] = m ? m.length : 0;
        });
        return counts;
    }

    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function highlightFillers(text) {
        var matchers = FILLERS.map(function (f) {
            return { re: fillerRegex(f, isNonLatin([f])), pre: false, len: f.length };
        }).concat(LANG_CONFIG[currentLang].hes.map(function (w) {
            return { re: hesRegex(w), pre: !isUnspacedLang(), len: w.length };
        }));
        matchers.sort(function (a, b) { return b.len - a.len; });
        var ranges = [];
        matchers.forEach(function (m) {
            var r;
            m.re.lastIndex = 0;
            while ((r = m.re.exec(text)) !== null) {
                if (!r[0].length) { m.re.lastIndex++; continue; }
                var start = r.index + (m.pre ? r[1].length : 0), end = r.index + r[0].length;
                var overlaps = ranges.some(function (g) { return start < g[1] && end > g[0]; });
                if (!overlaps) ranges.push([start, end]);
            }
        });
        ranges.sort(function (a, b) { return a[0] - b[0]; });
        var out = '', pos = 0;
        ranges.forEach(function (g) {
            out += escapeHtml(text.slice(pos, g[0])) + '<span class="filler-highlight">' + escapeHtml(text.slice(g[0], g[1])) + '</span>';
            pos = g[1];
        });
        return out + escapeHtml(text.slice(pos));
    }

    // ── Score ──
    function calcScore(totalFillers, avgWPM) {
        var score = 100;
        score -= totalFillers * 3;
        if (avgWPM > 0) {
            if (avgWPM < 110 || avgWPM > 165) { score -= 10; }
            else if (avgWPM >= 110 && avgWPM <= 129) { score -= 5; }
            else if (avgWPM >= 130 && avgWPM <= 160) { score += 5; }
        }
        return Math.max(0, Math.min(100, score));
    }

    function scoreGrade(score) {
        if (score >= 90) return 'Excellent';
        if (score >= 75) return 'Strong';
        if (score >= 60) return 'Good';
        if (score >= 45) return 'Needs Work';
        return 'Keep Practicing';
    }

    function scoreColor(score) {
        if (score >= 90) return '#16a34a';
        if (score >= 75) return '#2d5a44';
        if (score >= 60) return '#d97706';
        if (score >= 45) return '#ea580c';
        return '#dc2626';
    }

    // ── Status dot ──
    function setStatusDot(state) {
        var dot = document.getElementById('statusDot');
        if (dot) dot.className = 'status-dot ' + state;
    }

    // ── Watchdog: force-restart if silent for >8s ──
    function startWatchdog() {
        stopWatchdog();
        lastActivityTime = Date.now();
        watchdogInterval = setInterval(function () {
            if (!isRecording || isRestarting) return;
            if (Date.now() - lastActivityTime > 8000) {
                lastActivityTime = Date.now(); // prevent re-trigger next tick
                try { recognition.stop(); } catch (e) {} // onend handles restart
            }
        }, 5000);
    }

    function stopWatchdog() {
        if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
    }

    // ── Desktop buzz via Web Audio API ──
    function playBuzzSound() {
        if (!buzzerAC || buzzerAC.state !== 'running') return;
        var osc = buzzerAC.createOscillator();
        var gain = buzzerAC.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 180;
        gain.gain.setValueAtTime(0.18, buzzerAC.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, buzzerAC.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(buzzerAC.destination);
        osc.start();
        osc.stop(buzzerAC.currentTime + 0.18);
    }

    // ── Alert: flash + vibrate ──
    function triggerFillerAlert() {
        var flash = document.getElementById('filler-flash');
        flash.classList.remove('flash');
        void flash.offsetWidth; // reflow to restart animation
        flash.classList.add('flash');

        var box = document.getElementById('transcript');
        box.classList.remove('filler-pulse');
        void box.offsetWidth;
        box.classList.add('filler-pulse');

        if (navigator.vibrate) navigator.vibrate([80, 30, 80]);

        if (!window.matchMedia('(hover: none)').matches) {
            playBuzzSound();
        }
    }

    function popCounter(filler) {
        var i = filler === HES ? 'hes' : FILLERS.indexOf(filler);
        if (i === -1) return;
        var cardEl = document.getElementById('card-fc-' + i);
        if (!cardEl) return;
        cardEl.classList.remove('pop');
        void cardEl.offsetWidth;
        cardEl.classList.add('pop');
    }

    // ── Render helpers ──
    function showDots() {
        clearTimeout(typingDotsTimer);
        typingDotsTimer = null;
        if (dotsEl) dotsEl.classList.add('visible');
    }

    function hideDots() {
        clearTimeout(typingDotsTimer);
        typingDotsTimer = null;
        if (dotsEl) dotsEl.classList.remove('visible');
        // Restore placeholder if not recording and no text is showing
        if (!isRecording) {
            var finalEl = document.getElementById('transcript-final');
            if (finalEl && !finalEl.textContent.trim()) {
                var ph = document.getElementById('transcript-placeholder');
                if (ph) ph.style.display = '';
            }
        }
    }

    function renderTranscript(finalText, interimText) {
        var box = document.getElementById('transcript');
        var placeholderEl = document.getElementById('transcript-placeholder');
        var finalEl = document.getElementById('transcript-final');
        var interimEl = document.getElementById('transcript-interim');
        var hasFinal = finalText && finalText.trim();
        var hasInterim = interimText && interimText.trim();
        if (!hasFinal && !hasInterim) {
            finalEl.innerHTML = '';
            interimEl.textContent = '';
            if (isRecording) {
                // Dots replace placeholder while actively listening
                placeholderEl.style.display = 'none';
                if (dotsEl && !dotsEl.classList.contains('visible') && !typingDotsTimer) {
                    typingDotsTimer = setTimeout(showDots, 1500);
                }
            } else {
                hideDots();
                placeholderEl.style.display = '';
            }
        } else {
            hideDots();
            placeholderEl.style.display = 'none';
            finalEl.innerHTML = highlightFillers(finalText || '');
            interimEl.textContent = interimText || '';
            box.scrollTop = box.scrollHeight;
        }
    }

    function renderCounters() {
        counterKeys().forEach(function (filler, k) {
            var id = filler === HES ? 'fc-hes' : 'fc-' + (k - 1);
            var numEl = document.getElementById('count-' + id);
            var cardEl = document.getElementById('card-' + id);
            if (numEl) numEl.textContent = fillerCounts[filler];
            if (cardEl) {
                if (fillerCounts[filler] > 0) {
                    cardEl.classList.add('active');
                } else {
                    cardEl.classList.remove('active');
                }
            }
        });
    }

    function getWPM() {
        if (sessionDuration < 4) return 0;
        var words = wordCount(accumulatedTranscript);
        return Math.round((words / sessionDuration) * 60);
    }

    function wordCount(str) {
        return (str.trim().match(/\S+/g) || []).length;
    }

    function wpmColor(wpm) {
        if (wpm < 100) return '#3b82f6';   // blue  — too slow
        if (wpm <= 130) return '#b45309';  // amber — acceptable
        if (wpm <= 165) return '#15803d';  // green — ideal
        return '#ef4444';                   // red   — too fast
    }

    function renderWPM() {
        var wpm = getWPM();
        var wpmEl = document.getElementById('wpmDisplay');
        var wordsEl = document.getElementById('wordsDisplay');
        wordsEl.textContent = wordCount(accumulatedTranscript);
        if (wpm === 0) {
            wpmEl.textContent = '--';
            wpmEl.style.color = '#6b7280';
        } else {
            wpmEl.textContent = wpm;
            wpmEl.style.color = wpmColor(wpm);
        }
    }

    function formatTime(s) {
        var m = Math.floor(s / 60);
        var sec = s % 60;
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    // ── Language application ──
    function applyLanguage(langCode) {
        currentLang = langCode;
        var cfg = LANG_CONFIG[langCode];
        FILLERS = cfg.fillers.slice();
        resetCounts();
        buildCounterCards();
        if (recognition) recognition.lang = langCode;
        var box = document.getElementById('transcript');
        if (box) {
            if (langCode === 'ar-SA') {
                box.setAttribute('dir', 'rtl');
                box.style.textAlign = 'right';
            } else {
                box.setAttribute('dir', 'ltr');
                box.style.textAlign = 'left';
            }
        }
    }

    var langSelectEl = document.getElementById('langSelect');
    if (langSelectEl) {
        langSelectEl.addEventListener('change', function () {
            if (!sessionActive) { applyLanguage(this.value); }
        });
    }

    function lockLangSelector()   { var w = document.getElementById('langSelectorWrap'); if (w) w.classList.add('locked'); }
    function unlockLangSelector() { var w = document.getElementById('langSelectorWrap'); if (w) w.classList.remove('locked'); }

    function lockCustomWordInput() {
        var w = document.getElementById('customWordWrap');
        var inp = document.getElementById('customWordInput');
        var btn = document.getElementById('customWordAddBtn');
        if (w) w.classList.add('locked');
        if (inp) inp.disabled = true;
        if (btn) btn.disabled = true;
    }
    function unlockCustomWordInput() {
        var w = document.getElementById('customWordWrap');
        var inp = document.getElementById('customWordInput');
        var btn = document.getElementById('customWordAddBtn');
        if (w) w.classList.remove('locked');
        if (inp) inp.disabled = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Add'; btn.style.background = ''; btn.style.color = ''; }
    }

    // ── Recording control ──
    var MIC_SVG_OFF = '<svg class="mic-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
        '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>' +
        '<line x1="12" y1="19" x2="12" y2="23"/>' +
        '<line x1="8" y1="23" x2="16" y2="23"/></svg>';

    var MIC_SVG_ON = '<svg class="mic-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor">' +
        '<rect x="6" y="4" width="4" height="16" rx="1"/>' +
        '<rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

    function startRecording() {
        if (!recognition) {
            alert('Speech recognition is not supported. Please use Chrome or Edge on desktop.');
            return;
        }
        isRecording = true;
        sessionActive = true;

        // Full reset
        sessionDuration = 0;
        accumulatedTranscript = '';
        resetCounts();
        document.getElementById('timer').textContent = '0:00';
        document.getElementById('wpmDisplay').textContent = '--';
        document.getElementById('wpmDisplay').style.color = '#6b7280';
        document.getElementById('wordsDisplay').textContent = '0';
        renderTranscript('', '');
        renderCounters();

        var btn = document.getElementById('micButton');
        btn.classList.add('active');
        btn.innerHTML = MIC_SVG_ON;
        btn.setAttribute('aria-label', 'Pause recording');
        document.getElementById('buttonLabel').textContent = 'Listening...';
        document.getElementById('endSessionBtn').style.display = 'inline-block';
        document.getElementById('demoCard').classList.add('recording');
        lockLangSelector();

        // Read custom word input and add to filler list for this session
        var cwInput = document.getElementById('customWordInput');
        customWord = cwInput ? cwInput.value.trim().toLowerCase() : '';
        customWordLabel = customWord ? customWord.toUpperCase() : '';
        // A custom "um" is already covered by the hesitation counter.
        if (customWord && LANG_CONFIG[currentLang].hes.indexOf(customWord) !== -1) {
            customWord = '';
            customWordLabel = '';
        }
        if (customWord) {
            FILLERS.push(customWord);
            fillerCounts[customWord] = 0;
        }
        buildCounterCards();
        lockCustomWordInput();

        showDots();

        isRestarting = false;
        if (recognition) recognition.lang = currentLang;
        try { recognition.start(); } catch (e) {}
        startWatchdog();

        timerInterval = setInterval(function () {
            sessionDuration++;
            document.getElementById('timer').textContent = formatTime(sessionDuration);
            renderWPM();
        }, 1000);

    }

    function pauseRecording() {
        isRecording = false;
        stopWatchdog();
        try { recognition.stop(); } catch (e) {}
        clearInterval(timerInterval);
        setStatusDot('');

        var btn = document.getElementById('micButton');
        btn.classList.remove('active');
        btn.innerHTML = MIC_SVG_OFF;
        btn.setAttribute('aria-label', 'Resume recording');
        document.getElementById('buttonLabel').textContent = 'Paused - tap to resume';
        document.getElementById('demoCard').classList.remove('recording');
        hideDots();
    }

    function resumeRecording() {
        isRecording = true;
        isRestarting = false;
        document.getElementById('demoCard').classList.add('recording');
        if (!accumulatedTranscript.trim()) { showDots(); }
        var btn = document.getElementById('micButton');
        btn.classList.add('active');
        btn.innerHTML = MIC_SVG_ON;
        btn.setAttribute('aria-label', 'Pause recording');
        document.getElementById('buttonLabel').textContent = 'Listening...';
        try { recognition.start(); } catch (e) {}
        startWatchdog();
        timerInterval = setInterval(function () {
            sessionDuration++;
            document.getElementById('timer').textContent = formatTime(sessionDuration);
            renderWPM();
        }, 1000);
    }

    function endSession() {
        if (isRecording) pauseRecording();
        sessionActive = false;
        stopWatchdog();
        setStatusDot('');
        document.getElementById('endSessionBtn').style.display = 'none';
        document.getElementById('buttonLabel').textContent = '';
        showModal();
    }

    function resetDemo() {
        sessionActive = false;
        isRecording = false;
        isRestarting = false;
        stopWatchdog();
        setStatusDot('');
        sessionDuration = 0;
        accumulatedTranscript = '';
        // Restore base fillers (drops custom word from previous session)
        customWord = '';
        customWordLabel = '';
        FILLERS = LANG_CONFIG[currentLang].fillers.slice();
        resetCounts();

        document.getElementById('timer').textContent = '0:00';
        document.getElementById('wpmDisplay').textContent = '--';
        document.getElementById('wpmDisplay').style.color = '#6b7280';
        document.getElementById('wordsDisplay').textContent = '0';
        document.getElementById('buttonLabel').textContent = '';
        document.getElementById('endSessionBtn').style.display = 'none';
        document.getElementById('demoCard').classList.remove('recording');

        var btn = document.getElementById('micButton');
        btn.classList.remove('active');
        btn.innerHTML = MIC_SVG_OFF;
        btn.setAttribute('aria-label', 'Start recording');

        unlockLangSelector();
        unlockCustomWordInput();
        hideDots();
        renderTranscript('', '');
        buildCounterCards();
        renderCounters();
    }

    // ── Modal ──
    function showModal() {
        var totalFillers = counterKeys().reduce(function (s, f) { return s + fillerCounts[f]; }, 0);
        var words = wordCount(accumulatedTranscript);
        var avgWPM = sessionDuration >= 4 ? Math.round((words / sessionDuration) * 60) : 0;

        document.getElementById('summaryDuration').textContent = formatTime(sessionDuration);
        document.getElementById('summaryWords').textContent = words;
        document.getElementById('summaryFillers').textContent = totalFillers;

        var wpmEl = document.getElementById('summaryWPM');
        if (avgWPM > 0) {
            wpmEl.textContent = avgWPM;
            wpmEl.style.color = wpmColor(avgWPM);
        } else {
            wpmEl.textContent = '--';
            wpmEl.style.color = '#1e3a2e';
        }

        document.getElementById('coachingNote').textContent = buildNote(totalFillers, avgWPM, words, sessionDuration);

        // Score
        var score = calcScore(totalFillers, avgWPM);
        var scoreEl = document.getElementById('scoreValue');
        var scoreLabelEl = document.getElementById('scoreLabel');
        var color = scoreColor(score);
        scoreEl.style.color = color;
        scoreLabelEl.textContent = scoreGrade(score);
        var startTime = null;
        var duration = 900;
        function animateScore(ts) {
            if (!startTime) startTime = ts;
            var progress = Math.min((ts - startTime) / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3);
            scoreEl.textContent = Math.round(eased * score);
            if (progress < 1) requestAnimationFrame(animateScore);
        }
        requestAnimationFrame(animateScore);

        document.getElementById('modalOverlay').classList.add('visible');
    }

    function buildNote(totalFillers, avgWPM, words, duration) {
        if (words < 5) {
            return 'We didn\'t detect any speech. Make sure your microphone is working and try speaking clearly into it.';
        }
        if (duration < 30) {
            return 'Your session was very short. Try speaking for at least 30 seconds to get meaningful feedback.';
        }

        var fillersPerWord = words > 0 ? totalFillers / words : 0;
        var highFillerRate = fillersPerWord > (1 / 20); // more than 1 filler per 20 words

        // Find most-used filler
        var topFiller = null, topCount = 0;
        counterKeys().forEach(function (f) {
            if (fillerCounts[f] > topCount) { topFiller = f; topCount = fillerCounts[f]; }
        });
        var hesName = currentLang === 'en-US' ? '"um" and "uh"' : LANG_CONFIG[currentLang].hesLabel;
        var times = function (n) { return n + ' time' + (n !== 1 ? 's' : ''); };

        // ── Filler note ──
        var fillerNote = '';
        if (totalFillers === 0) {
            fillerNote = 'No filler words were detected this session. Detection is an estimate, so a quiet or very short "um" can slip past it. Keep practicing with the same focus.';
        } else if (highFillerRate) {
            // Specific advice per filler word
            if (topFiller === HES) {
                fillerNote = 'Hesitation sounds (' + hesName + ') were your most common filler, about ' + times(topCount) + '. They usually surface when your brain is searching for the next word. A deliberate one-beat pause is always more confident than filling the gap out loud.';
            } else if (topFiller === 'like') {
                fillerNote = '"Like" appeared ' + topCount + ' time' + (topCount !== 1 ? 's' : '') + ' and is your most frequent filler. It tends to sneak in when you\'re bridging between ideas. Instead of reaching for it, let your last word land and pause before moving on.';
            } else if (topFiller === 'um') {
                fillerNote = '"Um" was your most common filler at ' + topCount + ' time' + (topCount !== 1 ? 's' : '') + '. It usually surfaces when your brain is searching for the next word. Slowing down slightly gives your thoughts time to form without filling the gap out loud.';
            } else if (topFiller === 'uh') {
                fillerNote = '"Uh" showed up ' + topCount + ' time' + (topCount !== 1 ? 's' : '') + ' and is your main filler. It\'s a reflex that kicks in when you feel pressure to keep talking. A deliberate one-beat pause is always more confident than an "uh."';
            } else {
                fillerNote = '"' + topFiller + '" appeared ' + topCount + ' time' + (topCount !== 1 ? 's' : '') + ' and is your dominant filler. Replace it with a clean pause. Silence holds attention better than any filler word.';
            }
        } else {
            // Low filler rate — specific per filler
            if (topFiller === HES) {
                fillerNote = 'Your most common filler was a hesitation sound (' + hesName + '). It usually appears while the next thought forms. Your rate is low, so training yourself to pause silently instead is a small adjustment with a noticeable payoff.';
            } else if (topFiller === 'like') {
                fillerNote = 'Your most common filler was "like". It tends to appear when transitioning between ideas. Try replacing it with a deliberate pause instead; your filler rate is low, so this is a small adjustment with a noticeable payoff.';
            } else if (topFiller === 'um') {
                fillerNote = 'You relied on "um" most. This usually happens when searching for the next word. Slowing down slightly gives your brain time to find it without filling the gap. Your rate is already low, so one more layer of awareness will sharpen this quickly.';
            } else if (topFiller === 'uh') {
                fillerNote = '"Uh" was your go-to filler. It\'s a natural stall while your next thought forms. Your count is low, but training yourself to pause silently instead will make your delivery noticeably cleaner.';
            } else if (topFiller) {
                fillerNote = '"' + topFiller + '" was your most frequent filler. Your rate is controlled overall. Swap it for a purposeful pause and most listeners won\'t notice the gap at all.';
            } else {
                fillerNote = 'Very few filler words. Your delivery is clean and controlled.';
            }
        }

        // ── Pace note ──
        var paceNote = '';
        if (avgWPM > 0) {
            if (avgWPM < 110) {
                paceNote = 'At ' + avgWPM + ' WPM your pace sounds hesitant. Push through your material with more forward momentum and trust that your audience is following along.';
            } else if (avgWPM <= 130) {
                paceNote = 'Your pace (' + avgWPM + ' WPM) is close to the ideal range. Nudging slightly faster will give your delivery more energy without sacrificing clarity.';
            } else if (avgWPM <= 160) {
                paceNote = 'At ' + avgWPM + ' WPM your pace is confident and clear, right in the range where listeners can absorb what you\'re saying without working to keep up.';
            } else {
                paceNote = 'At ' + avgWPM + ' WPM you\'re moving faster than your audience can fully absorb. Pull back and give your key points room to land.';
            }
        }

        // Append custom word count if it was tracked and detected but wasn't already the top filler
        var customNote = '';
        if (customWord && fillerCounts[customWord] > 0 && topFiller !== customWord) {
            var cCount = fillerCounts[customWord];
            customNote = ' Your tracked word \u201c' + customWord + '\u201d came up ' + cCount + ' time' + (cCount !== 1 ? 's' : '') + '.';
        }

        if (fillerNote && paceNote) {
            return fillerNote + ' ' + paceNote + customNote;
        }
        return (fillerNote || paceNote) + customNote;
    }

    // ── Event listeners ──
    document.getElementById('micButton').addEventListener('click', function () {
        if (!buzzerAC) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) buzzerAC = new AC();
        } else if (buzzerAC.state === 'suspended') {
            buzzerAC.resume();
        }

        if (!sessionActive && !isRecording) {
            var seen = false;
            try { seen = !!localStorage.getItem('verba_disclaimer_seen'); } catch (e) { seen = true; }
            if (!seen && window._verbaShowDisclaimer) {
                window._verbaShowDisclaimer();
                return;
            }
            startRecording();
        } else if (isRecording) {
            pauseRecording();
        } else {
            resumeRecording();
        }
    });

    document.getElementById('endSessionBtn').addEventListener('click', endSession);

    var addWordBtn = document.getElementById('customWordAddBtn');
    if (addWordBtn) {
        addWordBtn.addEventListener('click', function () {
            var inp = document.getElementById('customWordInput');
            if (!inp || !inp.value.trim()) return;
            addWordBtn.textContent = '\u2713 Added';
            addWordBtn.style.background = '#2d5a44';
            addWordBtn.style.color = '#fff';
            setTimeout(function () {
                addWordBtn.textContent = 'Add';
                addWordBtn.style.background = '';
                addWordBtn.style.color = '';
            }, 1500);
        });
    }

    document.getElementById('closeModal').addEventListener('click', function () {
        document.getElementById('modalOverlay').classList.remove('visible');
        resetDemo();
    });

})();

// ── Scroll entrance animations (Intersection Observer) ──
(function () {
    // Skip entirely if user prefers reduced motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Skip if browser doesn't support IntersectionObserver
    if (!('IntersectionObserver' in window)) return;

    var STAGGER = 0.08; // seconds between each staggered child

    // Each entry: the section to watch, and which children inside it to animate
    var DEFS = [
        {
            root: '.problem',
            items: 'h2, .problem-card'
        },
        {
            root: '.features',
            items: 'h2, .feature-flip'
        },
        {
            root: '.how-it-works',
            items: 'h2, .how-it-works-subtitle'
        },
        {
            root: '.demo-section',
            items: '.demo-badge, h2, .demo-subtitle, .browser-note, .demo-card-wrap'
        },
        {
            root: '.comparison',
            items: 'h2, .comparison-subtitle, .comparison-table'
        },
        {
            root: '.testimonials',
            items: '.testimonials-container h2, .testimonials-subtitle, .testimonials-scroll-wrapper'
        },
        {
            root: '.final-cta',
            items: 'h2, p, .cta-buttons'
        },
        {
            root: '.faq',
            items: 'h2, .faq-subtitle, .faq-list'
        }
    ];

    DEFS.forEach(function (def) {
        var section = document.querySelector(def.root);
        if (!section) return;

        var items = Array.from(section.querySelectorAll(def.items));
        if (!items.length) return;

        // Mark each item as hidden with a staggered delay
        items.forEach(function (el, i) {
            el.classList.add('anim-hidden');
            el.style.transitionDelay = (i * STAGGER).toFixed(2) + 's';
        });

        // Observe the section; when it enters the viewport, reveal all children
        var obs = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) {
                items.forEach(function (el) {
                    el.classList.add('anim-visible');
                });
                obs.disconnect(); // animate once only
            }
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        });

        obs.observe(section);
    });
}());

/* ── How It Works timeline animation ── */
(function () {
    var section = document.querySelector('.how-it-works');
    if (!section) return;
    // If reduced motion, show everything immediately
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        section.classList.add('hiw-active');
        return;
    }
    var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
            section.classList.add('hiw-active');
            obs.disconnect();
        }
    }, { threshold: 0.3, rootMargin: '0px 0px -40px 0px' });
    obs.observe(section);
}());

/* ── Disclaimer modal (shown on first mic click) ── */
(function () {
    var overlay    = document.getElementById('disclaimerOverlay');
    var confirmBtn = document.getElementById('disclaimerConfirm');
    if (!overlay || !confirmBtn) return;

    var cancelBtn  = document.getElementById('disclaimerCancel');
    var returnFocus = null;

    function hide() {
        overlay.classList.remove('visible');
        if (returnFocus && returnFocus.focus) returnFocus.focus();
    }

    if (cancelBtn) cancelBtn.addEventListener('click', hide);
    overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { hide(); return; }
        if (e.key !== 'Tab') return;
        var f = overlay.querySelectorAll('a[href], button');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    confirmBtn.addEventListener('click', function () {
        try { localStorage.setItem('verba_disclaimer_seen', '1'); } catch (e) {}
        hide();
        // Trigger the mic button — localStorage is now set so recording starts immediately
        var micBtn = document.getElementById('micButton');
        if (micBtn) micBtn.click();
    });

    window._verbaShowDisclaimer = function () {
        returnFocus = document.activeElement;
        overlay.classList.add('visible');
        setTimeout(function () { confirmBtn.focus(); }, 50);
    };
}());

/* ── FAQ accordion ── */
(function () {
    var items = Array.from(document.querySelectorAll('.faq-item'));
    if (!items.length) return;
    items.forEach(function (item) {
        var q = item.querySelector('.faq-question');
        var a = item.querySelector('.faq-answer');
        if (a && !a.id) { a.id = 'faq-answer-' + items.indexOf(item); }
        if (a) { q.setAttribute('aria-controls', a.id); }
        q.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q.click(); }
        });
        q.addEventListener('click', function () {
            var isOpen = item.classList.contains('open');
            items.forEach(function (i) {
                i.classList.remove('open');
                i.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
            });
            if (!isOpen) {
                item.classList.add('open');
                item.querySelector('.faq-question').setAttribute('aria-expanded', 'true');
            }
        });
    });
}());

(function () {
    var wordEl = document.getElementById('fillerWord');
    var wrapEl = document.getElementById('fillerWrap');
    if (!wordEl || !wrapEl) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var words = ['um...', 'uh...', 'like...', 'you know...', 'nervous pacing...'];
    var idx = 0;

    function runCycle() {
        // Hold visible for 900ms, then draw strikethrough
        setTimeout(function () {
            wrapEl.classList.add('striking');
            // After strikethrough finishes (450ms), fade out
            setTimeout(function () {
                wrapEl.style.opacity = '0';
                // After fade (350ms), swap word and fade back in
                setTimeout(function () {
                    idx = (idx + 1) % words.length;
                    wordEl.textContent = words[idx];
                    wrapEl.classList.remove('striking');
                    wrapEl.style.opacity = '';
                    runCycle();
                }, 350);
            }, 500);
        }, 900);
    }

    runCycle();
}());

(function () {
    var table = document.querySelector('.comparison-table table');
    if (!table) return;

    var elCoaching = document.getElementById('price-coaching');
    var elApps     = document.getElementById('price-apps');
    var elCourses  = document.getElementById('price-courses');
    var elVerba    = document.getElementById('price-verba');
    if (!elCoaching || !elApps || !elCourses || !elVerba) return;

    // Reduced-motion: show final values immediately, no animation
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        elCoaching.textContent = '$100+';
        elApps.textContent     = 'Varies';
        elCourses.textContent  = '$12+';
        elVerba.innerHTML      = '<strong>$6</strong>';
        elVerba.classList.add('price-land');
        return;
    }

    // Hide all four cells until the table enters view
    elCoaching.textContent = '';
    elApps.textContent     = '';
    elCourses.textContent  = '';
    elVerba.innerHTML      = '';

    var triggered = false;
    var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !triggered) {
            triggered = true;
            obs.unobserve(table);
            runOthers();
        }
    }, { threshold: 0.4 });
    obs.observe(table);

    // ── Phase 1: count Coaching, Apps, Courses over 1500ms simultaneously ──
    function runOthers() {
        var others = [
            { el: elCoaching, end: 100, suffix: '+' },
                        { el: elCourses,  end: 12,  suffix: '+' },
        ];
        var DURATION = 1500;
        var t0 = null;

        // Show "..." in Verba while others are counting
        elVerba.innerHTML = '<strong>...</strong>';
        elVerba.style.opacity = '1';
        elApps.textContent = 'Varies';

        function tick(ts) {
            if (t0 === null) t0 = ts;
            var elapsed = ts - t0;
            var progress = Math.min(elapsed / DURATION, 1);
            var eased = 1 - Math.pow(1 - progress, 3);

            others.forEach(function (p) {
                var val = Math.round(eased * p.end);
                p.el.textContent = '$' + val + (progress >= 1 ? p.suffix : '');
            });

            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                // Lock final values with suffixes, then wait before Verba
                elCoaching.textContent = '$100+';
                elApps.textContent     = 'Varies';
                elCourses.textContent  = '$12+';
                setTimeout(runVerba, 400);
            }
        }

        requestAnimationFrame(tick);
    }

    // ── Phase 2: fade in Verba cell (0.3s), then count $0→$6 over 3600ms ──
    function runVerba() {
        var FADE_DURATION = 300;
        var COUNT_DURATION = 3600;
        var landed = false;

        // Fade out then fade back in to signal count is starting
        elVerba.style.transition = 'opacity ' + FADE_DURATION + 'ms ease';
        elVerba.style.opacity = '0';

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                elVerba.style.opacity = '1';
            });
        });

        // Start counter after fade completes
        setTimeout(function () {
            elVerba.style.transition = '';
            var t0 = null;

            function tick(ts) {
                if (t0 === null) t0 = ts;
                var elapsed = ts - t0;
                var progress = Math.min(elapsed / COUNT_DURATION, 1);
                var eased = 1 - Math.pow(1 - progress, 3);
                var val = Math.round(eased * 6);

                elVerba.innerHTML = '<strong>$' + val + '</strong>';

                // Trigger emphasis the exact frame val first reaches 6
                if (!landed && val >= 6) {
                    landed = true;
                    elVerba.classList.add('price-land');
                    setTimeout(function () { elVerba.classList.remove('price-land'); }, 1000);
                }

                if (progress < 1) {
                    requestAnimationFrame(tick);
                }
            }

            requestAnimationFrame(tick);
        }, FADE_DURATION);
    }
}());

(function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var MAX_TILT = 12;
    var cards = document.querySelectorAll('.testimonial-card');

    cards.forEach(function (card) {
        var shine = document.createElement('div');
        shine.className = 'card-shine';
        card.appendChild(shine);

        card.addEventListener('mouseenter', function () {
            card.style.transition = 'transform 0.15s ease-out, box-shadow 0.3s, border-color 0.3s';
        });

        card.addEventListener('mousemove', function (e) {
            var rect = card.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var dx = e.clientX - cx;
            var dy = e.clientY - cy;
            var rx = -(dy / (rect.height / 2)) * MAX_TILT;
            var ry =  (dx / (rect.width  / 2)) * MAX_TILT;

            card.style.transition = 'box-shadow 0.3s, border-color 0.3s';
            card.style.transform = 'perspective(1000px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) scale(1.02)';

            var px = ((e.clientX - rect.left) / rect.width)  * 100;
            var py = ((e.clientY - rect.top)  / rect.height) * 100;
            var tiltStrength = Math.sqrt(rx * rx + ry * ry) / MAX_TILT;
            shine.style.background = 'radial-gradient(circle at ' + px + '% ' + py + '%, rgba(255,255,255,' + (0.06 + tiltStrength * 0.14) + ') 0%, transparent 65%)';
            shine.style.opacity = '1';
        });

        card.addEventListener('mouseleave', function () {
            card.style.transition = 'transform 0.6s ease-out, box-shadow 0.3s, border-color 0.3s';
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
            shine.style.opacity = '0';
        });
    });
}());

(function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var RADIUS   = 80;
    var MAX_MOVE = 12;
    var LERP     = 0.12;

    var buttons = document.querySelectorAll('[data-magnetic]');

    buttons.forEach(function (btn) {
        var cx = 0, cy = 0, cs = 1;
        var tx = 0, ty = 0, ts = 1;
        var rafId = null;

        function tick() {
            cx += (tx - cx) * LERP;
            cy += (ty - cy) * LERP;
            cs += (ts - cs) * LERP;

            var done = Math.abs(tx - cx) < 0.05 && Math.abs(ty - cy) < 0.05 && Math.abs(ts - cs) < 0.002;
            if (done) {
                cx = tx; cy = ty; cs = ts;
                btn.style.transform = (tx === 0 && ty === 0 && ts === 1)
                    ? '' : 'translate(' + cx + 'px,' + cy + 'px) scale(' + cs + ')';
                rafId = null;
                return;
            }

            btn.style.transform = 'translate(' + cx + 'px,' + cy + 'px) scale(' + cs + ')';
            rafId = requestAnimationFrame(tick);
        }

        document.addEventListener('mousemove', function (e) {
            var rect = btn.getBoundingClientRect();
            var ocx  = rect.left + rect.width  / 2 - cx;
            var ocy  = rect.top  + rect.height / 2 - cy;
            var dx   = e.clientX - ocx;
            var dy   = e.clientY - ocy;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < RADIUS) {
                tx = (dx / RADIUS) * MAX_MOVE;
                ty = (dy / RADIUS) * MAX_MOVE;
                ts = 1.05;
            } else {
                tx = 0; ty = 0; ts = 1;
            }

            if (!rafId) rafId = requestAnimationFrame(tick);
        });
    });
}());

(function () {
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function showSuccess() {
        var el = document.getElementById('email-success');
        if (el) el.style.display = 'block';
    }

    function launchConfetti() {
        var section = document.querySelector('.email-capture');
        if (!section) return;

        var canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        function resize() {
            canvas.width  = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        // Burst origin: center of the email-capture section in viewport coords
        var rect = section.getBoundingClientRect();
        var ox = rect.left + rect.width  / 2;
        var oy = rect.top  + rect.height / 2;

        var COLORS = ['#1e3a2e', '#2d5a44', '#4caf7d', '#a8d5b5', '#ffffff', '#e8f5e9'];
        var COUNT  = 90;
        var DURATION = 3000; // ms

        var particles = [];
        for (var i = 0; i < COUNT; i++) {
            var angle = Math.random() * Math.PI * 2;
            var speed = 4 + Math.random() * 7;
            particles.push({
                x:    ox,
                y:    oy,
                vx:   Math.cos(angle) * speed,
                vy:   Math.sin(angle) * speed - (3 + Math.random() * 4), // bias upward
                w:    6 + Math.random() * 6,
                h:    3 + Math.random() * 4,
                rot:  Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * 0.25,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                alpha: 1
            });
        }

        var t0 = null;
        function draw(ts) {
            if (t0 === null) t0 = ts;
            var elapsed  = ts - t0;
            var progress = elapsed / DURATION;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            var alive = false;
            particles.forEach(function (p) {
                p.vy  += 0.18;          // gravity
                p.x   += p.vx;
                p.y   += p.vy;
                p.rot += p.spin;
                p.alpha = Math.max(0, 1 - progress * 1.3);

                if (p.alpha <= 0) return;
                alive = true;

                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            });

            if (alive && elapsed < DURATION + 500) {
                requestAnimationFrame(draw);
            } else {
                window.removeEventListener('resize', resize);
                canvas.parentNode && canvas.parentNode.removeChild(canvas);
            }
        }
        requestAnimationFrame(draw);
    }

    var fired = false;
    window.addEventListener('message', function (e) {
        if (fired) return;
        // Beehiiv posts various shapes — check for subscription success
        var d = e.data;
        if (!d) return;
        var isSuccess = false;
        if (typeof d === 'string') {
            try { d = JSON.parse(d); } catch (err) { /* not JSON */ }
        }
        if (typeof d === 'object' && d !== null) {
            // Beehiiv success event shapes seen in the wild
            isSuccess = d.type === 'beehiiv:subscribe:success'
                     || d.type === 'subscribe:success'
                     || d.event === 'subscribe'
                     || d.action === 'subscribe'
                     || d.subscribed === true;
        }
        if (!isSuccess) return;
        fired = true;
        showSuccess();
        if (!reducedMotion) launchConfetti();
    });
}());

/* ── Problem section: animated strikethrough ── */
(function () {
    var section = document.querySelector('.problem');
    if (!section) return;

    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var cards = [
        { strike: document.getElementById('prob-strike-0'), sol: document.getElementById('prob-sol-0') },
        { strike: document.getElementById('prob-strike-1'), sol: document.getElementById('prob-sol-1') },
        { strike: document.getElementById('prob-strike-2'), sol: document.getElementById('prob-sol-2') },
    ];

    var pendingTimers = [];

    function animateCard(card) {
        if (!card.strike || !card.sol) return;
        card.strike.classList.add('struck');
        if (reducedMotion) {
            card.sol.classList.add('visible');
        } else {
            pendingTimers.push(setTimeout(function () { card.sol.classList.add('visible'); }, 800));
        }
    }

    var obs = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        obs.disconnect(); // fire once only
        if (reducedMotion) {
            cards.forEach(function (card) { animateCard(card); });
        } else {
            pendingTimers.push(setTimeout(function () { animateCard(cards[0]); }, 1200));
            pendingTimers.push(setTimeout(function () { animateCard(cards[1]); }, 2000));
            pendingTimers.push(setTimeout(function () { animateCard(cards[2]); }, 2800));
        }
    }, { threshold: 0.4 });
    obs.observe(section);
}());

/* ── Mic ring + segment level meter: real Web Audio API ── */
(function () {
    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!window.AudioContext && !window.webkitAudioContext) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    var ring     = document.getElementById('micRing');
    var segMeter = document.getElementById('segMeter');
    var card     = document.getElementById('demoCard');
    if (!ring || !segMeter || !card) return;

    // Build 12 segment bars (top → bottom in DOM = top → bottom visually)
    var NUM_SEGS = 12;
    var segBars  = [];
    for (var k = 0; k < NUM_SEGS; k++) {
        var bar = document.createElement('div');
        bar.className = 'seg-meter-bar';
        segMeter.appendChild(bar);
        segBars.push(bar);
    }

    var audioCtx = null, analyser = null, micStream = null, rafId = null;
    var isActive = false;
    var smoothVol = 0;

    function setup(stream) {
        var AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        var source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        startHesitationDetector(audioCtx, source);
        micStream = stream;
        isActive = card.classList.contains('recording');
        if (!isActive) segMeter.classList.remove('active');
        rafId = requestAnimationFrame(draw);
    }

    // "Um"/"uh" detection from the raw signal (hesitation.js). It runs in an AudioWorklet
    // where available, otherwise in a ScriptProcessor. Detections are announced with a
    // "verba:hesitation" event; the demo script decides whether to count them.
    function startHesitationDetector(ctx, source) {
        function announce() { document.dispatchEvent(new CustomEvent('verba:hesitation')); }
        var sink = ctx.createGain();
        sink.gain.value = 0;            // keeps the node processing without making any sound
        sink.connect(ctx.destination);
        function fallback() {
            if (audioCtx !== ctx || !window.VerbaHesitationDetector || !ctx.createScriptProcessor) return;
            var detector = new window.VerbaHesitationDetector(ctx.sampleRate);
            detector.onDetect = announce;
            var node = ctx.createScriptProcessor(2048, 1, 1);
            node.onaudioprocess = function (e) { detector.process(e.inputBuffer.getChannelData(0)); };
            source.connect(node);
            node.connect(sink);
        }
        if (ctx.audioWorklet && window.AudioWorkletNode) {
            ctx.audioWorklet.addModule('hesitation.js').then(function () {
                if (audioCtx !== ctx) return;
                var node = new AudioWorkletNode(ctx, 'verba-hesitation');
                node.port.onmessage = function (e) { if (e.data && e.data.type === 'hesitation') announce(); };
                source.connect(node);
                node.connect(sink);
            }).catch(fallback);
        } else {
            fallback();
        }
    }

    function teardown() {
        isActive = false;
        // draw() will let smoothVol decay to zero, then clean up
    }

    function updateSegs(numLit) {
        // bars[0] = top, bars[NUM_SEGS-1] = bottom; fill from bottom
        for (var i = 0; i < NUM_SEGS; i++) {
            if (i >= NUM_SEGS - numLit) {
                segBars[i].classList.add('lit');
            } else {
                segBars[i].classList.remove('lit');
            }
        }
    }

    function draw() {
        var rms = 0;
        if (isActive && analyser) {
            var tdData = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(tdData);
            var sum = 0;
            for (var i = 0; i < tdData.length; i++) {
                var v = (tdData[i] - 128) / 128;
                sum += v * v;
            }
            rms = Math.sqrt(sum / tdData.length);
        }

        // Asymmetric smoothing: fast attack, slow decay
        var lerpFactor = isActive ? (rms > smoothVol ? 0.35 : 0.12) : 0.08;
        smoothVol += (rms - smoothVol) * lerpFactor;

        if (!prefersReduced) {
            // Ring: scale 1.0 at silence → ~1.45 at loud speech
            var scale   = 1 + smoothVol * 1.5;
            var opacity = Math.min(0.85, smoothVol * 5);
            ring.style.transform = 'scale(' + scale.toFixed(3) + ')';
            ring.style.opacity   = opacity.toFixed(3);
        }

        // Segment meter: rms 0–0.25 maps to 0–12 lit segments
        var numLit = Math.round(Math.min(1, smoothVol * 4) * NUM_SEGS);
        updateSegs(numLit);

        if (isActive || smoothVol > 0.001) {
            rafId = requestAnimationFrame(draw);
        } else {
            // Fully decayed — reset and release audio resources
            ring.style.transform = 'scale(1)';
            ring.style.opacity   = '0';
            updateSegs(0);
            if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
            if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
            analyser = null;
        }
    }

    // Watch demoCard for .recording class changes
    new MutationObserver(function () {
        var recording = card.classList.contains('recording');
        if (recording && !isActive && audioCtx) {
            // Resumed before the previous stream finished winding down: keep using it.
            segMeter.classList.add('active');
            isActive = true;
        } else if (recording && !isActive && !audioCtx) {
            segMeter.classList.add('active');
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(setup)
                .catch(function () { segMeter.classList.remove('active'); });
        } else if (!recording && isActive) {
            segMeter.classList.remove('active');
            teardown();
        }
    }).observe(card, { attributes: true, attributeFilter: ['class'] });
}());

/* ── Demo card gradient border: speed up on recording ── */
(function () {
    var wrap = document.getElementById('demoCardWrap');
    var card = document.getElementById('demoCard');
    if (!wrap || !card) return;
    new MutationObserver(function () {
        if (card.classList.contains('recording')) {
            wrap.classList.add('spinning-fast');
        } else {
            wrap.classList.remove('spinning-fast');
        }
    }).observe(card, { attributes: true, attributeFilter: ['class'] });
}());

/* ── Feature cards: keyboard focusable (CSS :focus-within flips them) ── */
(function () {
    Array.prototype.forEach.call(document.querySelectorAll('.feature-flip'), function (card) {
        card.setAttribute('tabindex', '0');
    });
}());
/* ── Testimonials marquee: pause control (WCAG 2.2.2) ── */
(function () {
    var track = document.querySelector('.testimonials-track');
    var wrapper = document.querySelector('.testimonials-scroll-wrapper');
    if (!track || !wrapper) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'marquee-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Pause scrolling';
    btn.addEventListener('click', function () {
        var paused = track.classList.toggle('paused');
        btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
        btn.textContent = paused ? 'Resume scrolling' : 'Pause scrolling';
    });
    wrapper.parentNode.insertBefore(btn, wrapper.nextSibling);
}());
/* ── Feature card flip: tap to flip on touch devices ── */
(function () {
    if (!window.matchMedia('(hover: none)').matches) return; // desktop uses CSS :hover
    var cards = Array.from(document.querySelectorAll('.feature-flip'));
    cards.forEach(function (card) {
        card.addEventListener('click', function () {
            var isFlipped = card.classList.contains('flipped');
            // Unflip all cards first
            cards.forEach(function (c) { c.classList.remove('flipped'); });
            // If this card wasn't already flipped, flip it now
            if (!isFlipped) {
                card.classList.add('flipped');
            }
        });
    });
}());

/* ── Comparison table: tooltip hints ── */
(function () {
    var isTouchDevice = window.matchMedia && window.matchMedia('(hover: none)').matches;
    if (!isTouchDevice) return; // hover handled by CSS; only need JS for touch

    var openCell = null;

    document.addEventListener('click', function (e) {
        var info = e.target.closest('.feat-info');
        if (info) {
            var cell = info.closest('.feat-cell');
            if (!cell) return;
            if (openCell && openCell !== cell) openCell.classList.remove('tip-open');
            cell.classList.toggle('tip-open');
            openCell = cell.classList.contains('tip-open') ? cell : null;
            e.stopPropagation();
            return;
        }
        // Tap anywhere else closes open tooltip
        if (openCell) {
            openCell.classList.remove('tip-open');
            openCell = null;
        }
    });
}());

/* ── Transparent nav: becomes solid once scrolled past hero ── */
(function () {
    var header = document.querySelector('header');
    var hero = document.querySelector('.hero');
    if (!header || !hero) return;
    function onScroll() {
        var heroBottom = hero.getBoundingClientRect().bottom + (window.scrollY || window.pageYOffset);
        if ((window.scrollY || window.pageYOffset) > heroBottom - header.offsetHeight) {
            header.classList.add('nav-scrolled');
        } else {
            header.classList.remove('nav-scrolled');
        }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}());
