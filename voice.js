/* Verba MVP: voice profiles.
 *
 * With the visitor's consent, each profile can have a voiceprint made from about 20 seconds
 * of speech. During a session Verba compares the speech it hears with those voiceprints to
 *   - switch to the person who started speaking,
 *   - either ignore "um"s from other voices ("Ignore them"), or note who said what ("Track
 *     each person"), shown in the session summary.
 *
 * Voiceprints are computed and kept on this device (localStorage), never uploaded. The model
 * runs in a Web Worker (voice-worker.js). Stored keys:
 *   verba_voice        { consent: true, at, mode: 'solo' | 'group', autoSwitch: bool }
 *   verba_voiceprints  { <profile id>: { v: [256 numbers], at, secs } }
 */
(function () {
    'use strict';

    var V = window.VerbaVoiceID, P = window.VerbaProfiles;
    if (!V || !P) return;

    // Calibrated on LibriSpeech dev-other (33 speakers) and checked on dev-clean (40 speakers),
    // clean and with fan noise or chatter mixed in 10 to 20 dB below the voice. On dev-clean:
    //   switching (two agreeing checks): quiet room 97% right, 0% wrong; moderate noise
    //     86 to 88% right, under 2% wrong. Off in loud places, where it was wrong 12 to 15%.
    //   "Ignore them", per 3 s check: quiet room catches 83% of other voices and wrongly
    //     ignores the speaker 0.4% of the time; moderate noise 73% and 2%; loud places,
    //     clearly recognized enrolled voices only: 33 to 36% and 3 to 4%.
    var CAL = {
        window: 3.0,        // seconds of speech per decision
        hop: 1.5,           // a new decision after this much more speech
        accept: 0.65,       // a voice this similar to a voiceprint is that person...
        margin: 0.08,       // ...when it also beats the next person by this much
        agree: 2,           // consecutive checks that must agree before switching profiles
        other: 0.62,        // below this, speech is not the active person ("Ignore them")
        loudSnr: 18,        // voice less than this many dB above the background: a loud place
        loudMargin: 0.16,   // in a loud place, how clearly another enrolled voice must win
        switchWithin: 30    // seconds into a session that an automatic switch may happen
    };
    function loud() { var s = window.VerbaMicInfo && window.VerbaMicInfo.snr; return typeof s === 'number' && s < CAL.loudSnr; }
    var ENROLL_SECONDS = 20, ENROLL_MIN = 10;
    var SETTINGS = 'verba_voice', PRINTS = 'verba_voiceprints';

    function $(id) { return document.getElementById(id); }
    function whose(name) { return name === 'Me' ? 'your' : name + '’s'; }
    function read(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v || fallback; } catch (e) { return fallback; } }
    function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
    var settings = read(SETTINGS, {});
    var prints = read(PRINTS, {});
    function consented() { return settings.consent === true; }
    function printFor(id) { var p = prints[id]; return p && Array.isArray(p.v) ? Float32Array.from(p.v) : null; }
    function enrolledIds() { return P.list().map(function (p) { return p.id; }).filter(function (id) { return !!prints[id]; }); }
    function saveSettings() { write(SETTINGS, settings); }
    function savePrints() { write(PRINTS, prints); }

    // ── Worker and model ──
    var base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    var worker = null, workerReady = null, jobs = {}, nextJob = 1;
    function preload(onProgress) {
        // Fetch the model once with progress, so the worker then reads it from the cache.
        if (!window.fetch || !window.ReadableStream) return Promise.resolve();
        return fetch('models/voice-resnet34.onnx').then(function (res) {
            if (!res.ok || !res.body) return;
            var total = +res.headers.get('content-length') || 26530550, got = 0, reader = res.body.getReader();
            function pump() {
                return reader.read().then(function (r) {
                    if (r.done) return;
                    got += r.value.length;
                    if (onProgress) onProgress(Math.min(1, got / total));
                    return pump();
                });
            }
            return pump();
        }).catch(function () {});
    }
    function ensureWorker(onProgress) {
        if (workerReady) return workerReady;
        workerReady = preload(onProgress).then(function () {
            return new Promise(function (resolve, reject) {
                try { worker = new Worker('voice-worker.js'); } catch (e) { reject(e); return; }
                worker.onmessage = function (e) {
                    var m = e.data || {};
                    if (m.type === 'ready') resolve();
                    else if (m.type === 'error') reject(new Error(m.message));
                    else if (m.type === 'emb' && jobs[m.id]) { jobs[m.id](m.v || null); delete jobs[m.id]; }
                };
                worker.onerror = function (e) { reject(e); };
                worker.postMessage({ type: 'init', base: base });
            });
        });
        workerReady.catch(function () { workerReady = null; worker = null; });
        return workerReady;
    }
    function embed(samples16k) {
        return ensureWorker().then(function () {
            return new Promise(function (resolve) {
                var id = nextJob++; jobs[id] = resolve;
                worker.postMessage({ type: 'embed', id: id, samples: samples16k }, [samples16k.buffer]);
            });
        });
    }

    // ── Speech selection: keep 20 ms frames that are clearly louder than the room ──
    function Collector(onSpeech) {
        this.raw = []; this.rawLen = 0; this.rate = 48000;
        this.levels = []; this.onSpeech = onSpeech;
    }
    Collector.prototype.push = function (chunk, rate) {
        this.rate = rate; this.raw.push(chunk); this.rawLen += chunk.length;
        if (this.rawLen < rate * 0.4) return;
        var all = new Float32Array(this.rawLen), o = 0;
        this.raw.forEach(function (c) { all.set(c, o); o += c.length; });
        this.raw = []; this.rawLen = 0;
        var x = V.resample(all, rate), now = Date.now(), F = 320, frames = Math.floor(x.length / F);
        var startT = now - x.length / 16;  // wall-clock time of the first sample, in ms
        for (var f = 0; f < frames; f++) {
            var s = 0;
            for (var i = f * F; i < (f + 1) * F; i++) s += x[i] * x[i];
            var db = 10 * Math.log10(s / F + 1e-12);
            this.levels.push(db); if (this.levels.length > 250) this.levels.shift();
            var sorted = this.levels.slice().sort(function (a, b) { return a - b; });
            var floor = sorted[Math.floor(sorted.length * 0.1)];
            if (db > floor + 12 && db > -60) this.onSpeech(x.subarray(f * F, (f + 1) * F), startT + f * 20);
        }
    };

    // ── Enrollment ──
    var PASSAGE = 'Every morning I practice speaking for a few minutes before class. I read a short article out loud, ' +
        'then I explain the main idea in my own words, as if I were talking to a friend. Some days it feels easy; ' +
        'other days I search for the right word and have to slow down. Either way, I finish by saying one clear ' +
        'sentence about what I learned, and I try to say it with confidence.';

    var enroll = null;   // { id, stream, ctx, node, speech: [], secs }
    function openEnroll(id) {
        if (P.isLocked()) return;
        var p = P.get(id); if (!p) return;
        enroll = { id: id, speech: [], secs: 0 };
        $('enrollTitle').textContent = 'Record ' + whose(p.name) + ' voice';
        $('enrollPassage').textContent = PASSAGE;
        setEnrollStage('ready');
        $('voiceEnrollOverlay').classList.add('visible');
        lastFocus = document.activeElement;
        setTimeout(function () { $('enrollStart').focus(); }, 30);
    }
    var lastFocus = null;
    function closeEnroll() {
        stopCapture();
        enroll = null;
        $('voiceEnrollOverlay').classList.remove('visible');
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function setEnrollStage(stage, text) {
        var el = $('voiceEnrollOverlay');
        el.setAttribute('data-stage', stage);
        $('enrollStart').hidden = stage !== 'ready' && stage !== 'failed';
        $('enrollStart').textContent = stage === 'failed' ? 'Try again' : 'Start recording';
        $('enrollStop').hidden = stage !== 'recording';
        $('enrollDone').hidden = stage !== 'saved';
        $('enrollCancel').hidden = stage === 'saved';
        $('enrollMeter').hidden = stage !== 'recording' && stage !== 'saving';
        if (text !== undefined) $('enrollStatus').textContent = text;
        else $('enrollStatus').textContent = stage === 'ready' ? 'Find a quiet spot, then press Start and read the passage at your normal volume.' : '';
    }
    function setEnrollProgress(frac) {
        $('enrollBar').style.width = Math.round(frac * 100) + '%';
        $('enrollMeter').setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    }
    function stopCapture() {
        if (!enroll) return;
        if (enroll.node) { try { enroll.node.disconnect(); } catch (e) {} enroll.node = null; }
        if (enroll.stream) { enroll.stream.getTracks().forEach(function (t) { t.stop(); }); enroll.stream = null; }
        if (enroll.ctx) { try { enroll.ctx.close(); } catch (e) {} enroll.ctx = null; }
    }
    function startCapture() {
        if (!enroll) return;
        var AC = window.AudioContext || window.webkitAudioContext;
        enroll.speech = []; enroll.secs = 0;
        try { enroll.ctx = new AC(); } catch (e) { setEnrollStage('failed', 'This browser cannot record audio.'); return; }
        if (enroll.ctx.state === 'suspended') enroll.ctx.resume();
        setEnrollStage('recording', 'Listening… read the passage aloud.');
        setEnrollProgress(0);
        ensureWorker();   // start loading the model while the person reads
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
            .then(function (stream) {
                if (!enroll) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
                enroll.stream = stream;
                var ctx = enroll.ctx, src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1);
                var sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
                var col = new Collector(function (frame) {
                    if (!enroll) return;
                    enroll.speech.push(new Float32Array(frame)); enroll.secs += 0.02;
                    setEnrollProgress(enroll.secs / ENROLL_SECONDS);
                    if (enroll.secs >= ENROLL_SECONDS) finishEnroll();
                });
                node.onaudioprocess = function (e) { col.push(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate); };
                src.connect(node); node.connect(sink);
                enroll.node = node;
            })
            .catch(function () { setEnrollStage('failed', 'Verba could not use the microphone. Check that this site is allowed to use it, then try again.'); });
    }
    function finishEnroll() {
        if (!enroll || enroll.finishing) return;
        if (enroll.secs < ENROLL_MIN) { $('enrollStatus').textContent = 'Keep reading: Verba needs at least ' + ENROLL_MIN + ' seconds of speech.'; return; }
        enroll.finishing = true;
        stopCapture();
        var e = enroll, total = e.speech.reduce(function (s, f) { return s + f.length; }, 0), all = new Float32Array(total), o = 0;
        e.speech.forEach(function (f) { all.set(f, o); o += f.length; });
        setEnrollStage('saving', 'Making the voiceprint on this device…');
        var parts = [], step = 16000 * CAL.window;
        for (var i = 0; i + step * 0.5 <= all.length; i += step) parts.push(all.slice(i, Math.min(all.length, i + step)));
        var vecs = [];
        parts.reduce(function (chain, part, k) {
            return chain.then(function () { return embed(part); }).then(function (v) { if (v) vecs.push(v); setEnrollProgress((k + 1) / parts.length); });
        }, Promise.resolve()).then(function () {
            if (!enroll || enroll !== e) return;
            var avg = V.average(vecs);
            if (!avg || vecs.length < 2) { e.finishing = false; setEnrollStage('failed', 'Not enough clear speech was recorded. Try again somewhere quieter.'); return; }
            // Consistency: the parts of one reading should sound like the same person.
            var agree = vecs.reduce(function (s, v) { return s + V.cosine(v, avg); }, 0) / vecs.length;
            if (agree < 0.6) { e.finishing = false; setEnrollStage('failed', 'The recording was too noisy or had more than one voice. Try again somewhere quieter.'); return; }
            var clash = enrolledIds().filter(function (id) { return id !== e.id && V.cosine(printFor(id), avg) >= CAL.accept + 0.08; })
                .map(function (id) { return P.get(id).name; });
            prints[e.id] = { v: Array.prototype.map.call(avg, function (x) { return Math.round(x * 1e5) / 1e5; }), at: Date.now(), secs: Math.round(e.secs) };
            savePrints();
            renderPanel();
            setEnrollStage('saved', 'Saved. Verba can now recognize ' + whose(P.get(e.id).name) + ' voice.' +
                (clash.length ? ' Note: this voice sounds very like ' + clash.join(' and ') + '. If it is the same person, delete one of the voiceprints.' : ''));
            setTimeout(function () { $('enrollDone').focus(); }, 30);
        }).catch(function () {
            e.finishing = false;
            setEnrollStage('failed', 'The voice model could not be loaded. Check your connection and try again.');
        });
    }

    // ── During a session ──
    var live = null;   // { speech: Float32Array ring, times, len, sinceLast, started, switched, who: {}, hes: [] }
    function sessionActive() { return !!live; }
    function tap(chunk, rate) { if (live) live.collector.push(chunk, rate); }
    function onSpeechFrame(frame, t) {
        var L = live; if (!L) return;
        L.frames.push({ x: new Float32Array(frame), t: t });
        var maxFrames = Math.round(CAL.window / 0.02);
        if (L.frames.length > maxFrames) L.frames.shift();
        L.since += 0.02;
        if (L.frames.length >= maxFrames && L.since >= (L.decisions ? CAL.hop : CAL.window) && !L.busy) decide();
    }
    function decide() {
        var L = live, frames = L.frames.slice(), from = frames[0].t, to = frames[frames.length - 1].t + 20;
        var x = new Float32Array(frames.length * 320);
        frames.forEach(function (f, i) { x.set(f.x, i * 320); });
        L.since = 0; L.busy = true;
        embed(x).then(function (v) {
            L.busy = false;
            if (!v || live !== L) return;
            L.decisions++;
            var u = V.normalize(v), scores = enrolledIds().map(function (id) { return { id: id, s: V.cosine(u, printFor(id)) }; })
                .sort(function (a, b) { return b.s - a.s; });
            if (!scores.length) return;
            var best = scores[0], second = scores[1] ? scores[1].s : -1;
            var sure = best.s >= CAL.accept && best.s - second >= CAL.margin;
            // 1. Switch to the person who is speaking, early in the session, once two checks
            //    in a row agree. Not in a loud place.
            if (sure && !loud()) { L.agree = L.agree && L.agree.id === best.id ? { id: best.id, n: L.agree.n + 1 } : { id: best.id, n: 1 }; }
            else L.agree = null;
            if (settings.autoSwitch !== false && !L.switched && L.agree && L.agree.n >= CAL.agree && (Date.now() - L.started) / 1000 <= CAL.switchWithin) {
                L.switched = true;
                if (best.id !== P.activeId() && P.setActive(best.id, 'voice')) {
                    status('Recognized ' + whose(P.get(best.id).name) + ' voice. Practicing as ' + P.get(best.id).name + '.');
                }
            }
            // 2. Who is talking right now.
            var label = sure ? best.id : 'unknown';
            L.who[label] = (L.who[label] || 0) + (L.decisions === 1 ? CAL.window : CAL.hop);
            L.hes.forEach(function (h) { if (!h.owner && h.t >= from - 500 && h.t <= to + 500) h.owner = label; });
            if ((settings.mode || 'solo') === 'solo') {
                var mine = printFor(P.activeId());
                var sMine = mine ? V.cosine(u, mine) : 1;
                // Another enrolled person clearly recognized, or a voice that is not the active
                // person's. In a loud place the speaker's own voice scores lower too, so only a
                // clearly recognized enrolled voice counts there.
                var isLoud = loud();
                var someoneElse = sure && best.id !== P.activeId() && best.s - sMine >= (isLoud ? CAL.loudMargin : CAL.margin);
                if (mine && (someoneElse || (!isLoud && sMine < CAL.other))) {
                    document.dispatchEvent(new CustomEvent('verba:other-voice', { detail: { from: from - 500, to: to + 500 } }));
                    status('Another voice was heard; its “um”s are not counted.');
                }
            }
        }, function () { L.busy = false; });
    }
    function startSession() {
        if (!consented() || !enrolledIds().length) return;
        live = { frames: [], since: 0, busy: false, decisions: 0, started: Date.now(), switched: false, who: {}, hes: [] };
        live.collector = new Collector(onSpeechFrame);
        ensureWorker();
        status(enrolledIds().length > 1 ? 'Listening for whose voice this is…' : '');
    }
    document.addEventListener('verba:session-start', startSession);
    document.addEventListener('verba:hesitation', function () { if (live) live.hes.push({ t: Date.now(), owner: null }); });
    document.addEventListener('verba:session-end', function () {
        var L = live; live = null;
        renderBreakdown(L);
    });
    document.addEventListener('verba:session-reset', function () { live = null; });
    window.VerbaMicTap = window.VerbaMicTap || { listeners: [] };
    window.VerbaMicTap.listeners.push(tap);

    function status(text) { var el = $('voiceStatus'); if (el) el.textContent = text; }

    // Summary: who spoke, when "Track each person" is on and more than one voice was heard.
    function renderBreakdown(L) {
        var box = $('speakerBreakdown'), list = $('speakerList');
        if (!box || !list) return;
        list.innerHTML = '';
        if (!L || (settings.mode || 'solo') !== 'group') { box.hidden = true; return; }
        var ids = Object.keys(L.who).filter(function (k) { return L.who[k] >= 3; });
        if (ids.filter(function (k) { return k !== 'unknown'; }).length < 2) { box.hidden = true; return; }
        ids.sort(function (a, b) { return L.who[b] - L.who[a]; });
        ids.forEach(function (k) {
            var li = document.createElement('li'), name = k === 'unknown' ? 'Someone not recognized' : (P.get(k) ? P.get(k).name : 'Removed profile');
            var ums = L.hes.filter(function (h) { return h.owner === k; }).length, secs = Math.round(L.who[k]);
            li.textContent = name + ': about ' + (secs >= 60 ? Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s' : secs + ' s') + ' of speech, ' +
                ums + ' “um” or “uh”';
            list.appendChild(li);
        });
        box.hidden = false;
    }

    // ── Panel and consent ──
    function renderPanel() {
        var body = $('voiceBody'), intro = $('voiceSetup');
        if (!body || !intro) return;
        intro.hidden = consented(); body.hidden = !consented();
        if (!consented()) return;
        var list = $('voiceList'); list.innerHTML = '';
        P.list().forEach(function (p) {
            var li = document.createElement('li'), info = document.createElement('span'), actions = document.createElement('span');
            info.className = 'voice-person';
            var has = !!prints[p.id], when = has ? new Date(prints[p.id].at) : null;
            info.textContent = p.name + (has ? ': voice saved ' + when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ': no voice yet');
            actions.className = 'voice-actions';
            var rec = document.createElement('button');
            rec.type = 'button'; rec.className = 'share-btn'; rec.textContent = has ? 'Record again' : 'Record voice';
            rec.disabled = P.isLocked();
            rec.addEventListener('click', function () { openEnroll(p.id); });
            actions.appendChild(rec);
            if (has) {
                var del = document.createElement('button');
                del.type = 'button'; del.className = 'share-btn'; del.textContent = 'Delete voice';
                del.addEventListener('click', function () {
                    if (!window.confirm('Delete ' + whose(p.name) + ' voiceprint from this device?')) return;
                    delete prints[p.id]; savePrints(); renderPanel();
                });
                actions.appendChild(del);
            }
            li.appendChild(info); li.appendChild(actions); list.appendChild(li);
        });
        $('voiceAutoSwitch').checked = settings.autoSwitch !== false;
        $('voiceModeSolo').checked = (settings.mode || 'solo') === 'solo';
        $('voiceModeGroup').checked = settings.mode === 'group';
    }
    function openConsent() {
        lastFocus = document.activeElement;
        $('voiceConsentAgree').checked = false;
        $('voiceConsentOk').disabled = true;
        $('voiceConsentOverlay').classList.add('visible');
        setTimeout(function () { $('voiceConsentAgree').focus(); }, 30);
    }
    function closeConsent() {
        $('voiceConsentOverlay').classList.remove('visible');
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
    on('voiceSetupBtn', 'click', openConsent);
    on('voiceConsentAgree', 'change', function () { $('voiceConsentOk').disabled = !this.checked; });
    on('voiceConsentCancel', 'click', closeConsent);
    on('voiceConsentOk', 'click', function () {
        if (!$('voiceConsentAgree').checked) return;
        settings = { consent: true, at: Date.now(), mode: 'solo', autoSwitch: true };
        saveSettings(); closeConsent(); renderPanel();
        var first = document.querySelector('#voiceList button'); if (first) first.focus();
    });
    on('voiceAutoSwitch', 'change', function () { settings.autoSwitch = this.checked; saveSettings(); });
    on('voiceModeSolo', 'change', function () { if (this.checked) { settings.mode = 'solo'; saveSettings(); } });
    on('voiceModeGroup', 'change', function () { if (this.checked) { settings.mode = 'group'; saveSettings(); } });
    on('voiceDeleteAll', 'click', function () {
        if (!window.confirm('Delete every voiceprint on this device and turn voice profiles off?')) return;
        prints = {}; settings = {};
        try { localStorage.removeItem(PRINTS); localStorage.removeItem(SETTINGS); } catch (e) {}
        renderPanel(); status('');
        var b = $('voiceSetupBtn'); if (b) b.focus();
    });
    on('enrollStart', 'click', startCapture);
    on('enrollStop', 'click', finishEnroll);
    on('enrollCancel', 'click', closeEnroll);
    on('enrollDone', 'click', closeEnroll);
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if ($('voiceEnrollOverlay') && $('voiceEnrollOverlay').classList.contains('visible')) closeEnroll();
        else if ($('voiceConsentOverlay') && $('voiceConsentOverlay').classList.contains('visible')) closeConsent();
    });
    document.addEventListener('verba:profile', renderPanel);
    document.addEventListener('verba:profile-removed', function (e) {
        if (e.detail && prints[e.detail.id]) { delete prints[e.detail.id]; savePrints(); }
    });
    document.addEventListener('verba:session-start', renderPanel);
    document.addEventListener('verba:session-reset', renderPanel);
    renderPanel();

    window.VerbaVoice = { settings: function () { return settings; }, enrolled: enrolledIds, isLive: sessionActive, CAL: CAL };
}());
