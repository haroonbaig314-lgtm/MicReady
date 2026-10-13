/* Verba MVP: voice profiles.
 *
 * With the visitor's consent, each profile can have a voiceprint made from about 15 seconds
 * of reading aloud. During a session Verba compares the speech it hears with those voiceprints:
 *   - solo practice: switch to the person who started speaking, and ignore "um"s from other
 *     voices;
 *   - group practice: follow who is speaking as people take turns, and give each person their
 *     own results (voiceid.js attribute), saved to their own progress.
 *
 * Voiceprints are computed and kept on this device (localStorage), never uploaded. The model
 * runs in a Web Worker (voice-worker.js). Stored keys:
 *   verba_voice        { consent: true, at, mode: 'solo' | 'group', autoSwitch: bool }
 *   verba_voiceprints  { <profile id>: { v: [256 numbers], at, secs, fv: 2 } }
 *                      or { outdated: true, at } where a voiceprint from an earlier version of
 *                      the recognition was deleted and the person is asked to record again
 */
(function () {
    'use strict';

    var V = window.VerbaVoiceID, P = window.VerbaProfiles;
    if (!V || !P) return;

    // Calibrated on LibriSpeech dev-other (33 speakers) and checked on dev-clean (40 speakers),
    // clean and with fan noise or chatter mixed in 10 to 20 dB below the voice. On dev-clean:
    //   switching (two agreeing checks): 98.9 to 99.7% right and never wrong, in every condition;
    //     when someone not enrolled speaks first, it switches to an enrolled person in 1% of
    //     sessions.
    //   "Ignore them", per 3 s check: catches 98.5 to 99% of other voices, and wrongly ignores
    //     the speaker at most 0.5% of the time.
    //   group practice (simulated presentations by 2 to 4 people, see tests/group.spec.js):
    //     speaking time credited to the right person 100% of the time in a quiet room, 97 to
    //     98% with moderate noise, 90 to 93% in loud places; "um"s 100%, 97%, 91 to 94%.
    //   Below 10 dB of voice over the background (not tested), only clearly recognized
    //   enrolled voices count.
    var CAL = {
        window: 3.0,        // seconds of speech per decision
        hop: 1.5,           // a new decision after this much more speech
        accept: 0.45,       // a voice this similar to a voiceprint is that person...
        margin: 0.15,       // ...when it also beats the next person by this much
        agree: 2,           // consecutive checks that must agree before switching profiles
        other: 0.35,        // below this, speech is not the active person ("Ignore them")
        loudSnr: 10,        // voice less than this many dB above the background: a very loud place
        loudMargin: 0.25,   // in a very loud place, how clearly another enrolled voice must win
        switchWithin: 30,   // seconds into a session that an automatic switch may happen
        consistency: 0.3,   // every two 3 s parts of one voice recording must be at least this alike:
                            // in a quiet room this rejects 0.5% of single voices and catches 99% of two
        clash: 0.6,         // two people's voiceprints this alike are probably the same person
        // Group practice (voiceid.js attribute): the cost of a change of speaker, and how a
        // voice that is no one enrolled scores
        switchCost: 0.1,
        unknown: 0.35
    };
    function loud() { var s = window.VerbaMicInfo && window.VerbaMicInfo.snr; return typeof s === 'number' && s < CAL.loudSnr; }
    // A voice recording: 10 s of speech, which takes about 12 s of reading aloud (LibriSpeech,
    // median) and makes a voiceprint as accurate as 20 s does (per 3 s check, 98.1% right vs
    // 98.2%, never wrong). "Finish now" works from 6 s (97.8% right).
    var ENROLL_SECONDS = 10, ENROLL_MIN = 6, ENROLL_HANG = 15;
    var SETTINGS = 'verba_voice', PRINTS = 'verba_voiceprints';

    function $(id) { return document.getElementById(id); }
    function whose(name) { return name === 'Me' ? 'your' : name + '’s'; }
    function read(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v || fallback; } catch (e) { return fallback; } }
    function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
    var settings = read(SETTINGS, {});
    var prints = read(PRINTS, {});
    function consented() { return settings.consent === true; }
    // Voiceprints made before the features were mean-normalized (no fv) do not match new ones:
    // they are deleted, and the person is asked to record again.
    var PRINT_VERSION = 2;
    function current(p) { return !!p && p.fv === PRINT_VERSION && Array.isArray(p.v); }
    (function () {
        var changed = false;
        Object.keys(prints).forEach(function (id) {
            var p = prints[id];
            if (!current(p) && !(p && p.outdated)) { prints[id] = { outdated: true, at: p && p.at || Date.now() }; changed = true; }
        });
        if (changed) write(PRINTS, prints);
    }());
    function printFor(id) { var p = prints[id]; return current(p) ? Float32Array.from(p.v) : null; }
    function enrolledIds() { return P.list().map(function (p) { return p.id; }).filter(function (id) { return current(prints[id]); }); }
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
                // The version keeps a cached copy of older recognition code out of the worker.
                try { worker = new Worker('voice-worker.js?v=' + PRINT_VERSION); } catch (e) { reject(e); return; }
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
    // hang: also keep the quieter frames up to this many frames after a loud one, so whole
    // stretches of speech count (recording a voice). 0 keeps only the loud frames, as the checks
    // during a session were calibrated.
    function Collector(onSpeech, hang) {
        this.raw = []; this.rawLen = 0; this.rate = 48000;
        this.levels = []; this.onSpeech = onSpeech;
        this.hang = hang || 0; this.n = 0; this.lastLoud = -1e9;
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
            var loud = db > floor + 12 && db > -60;
            if (loud) this.lastLoud = this.n;
            if (loud || (this.hang && this.n - this.lastLoud <= this.hang && db > -60)) this.onSpeech(x.subarray(f * F, (f + 1) * F), startT + f * 20);
            this.n++;
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
                }, ENROLL_HANG);
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
        setEnrollStage('saving', 'Got it. You can stop reading. Making the voiceprint on this device…');
        var parts = [], step = 16000 * CAL.window;
        for (var i = 0; i + step * 0.5 <= all.length; i += step) parts.push(all.slice(i, Math.min(all.length, i + step)));
        var vecs = [];
        parts.reduce(function (chain, part, k) {
            return chain.then(function () { return embed(part); }).then(function (v) { if (v) vecs.push(v); setEnrollProgress((k + 1) / parts.length); });
        }, Promise.resolve()).then(function () {
            if (!enroll || enroll !== e) return;
            var avg = V.average(vecs);
            if (!avg || vecs.length < 2) { e.finishing = false; setEnrollStage('failed', 'Not enough clear speech was recorded. Try again somewhere quieter.'); return; }
            // Consistency: every two parts of one reading should sound like the same person.
            var agree = 1;
            vecs.forEach(function (a, i) { vecs.slice(i + 1).forEach(function (b) { agree = Math.min(agree, V.cosine(a, b)); }); });
            if (agree < CAL.consistency) { e.finishing = false; setEnrollStage('failed', 'The recording was too noisy or had more than one voice. Try again somewhere quieter.'); return; }
            var clash = enrolledIds().filter(function (id) { return id !== e.id && V.cosine(printFor(id), avg) >= CAL.clash; })
                .map(function (id) { return P.get(id).name; });
            prints[e.id] = { v: Array.prototype.map.call(avg, function (x) { return Math.round(x * 1e5) / 1e5; }), at: Date.now(), secs: Math.round(e.secs), fv: PRINT_VERSION };
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
    // { collector, frames: last 3 s of speech, since, busy, decisions, started, switched, mode,
    //   timeline: every check's scores, hes / pauses / chunks: what the session counted, and when }
    var live = null;
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
            var all = {};
            scores.forEach(function (x) { all[x.id] = x.s; });
            L.timeline.push({ from: from, to: to, scores: all });
            if (L.mode === 'group') { L.current = sure ? best.id : null; renderLive(L, L.current); return; }
            // 1. Switch to the person who is speaking, early in the session, once two checks
            //    in a row agree. Not in a very loud place.
            if (sure && !loud()) { L.agree = L.agree && L.agree.id === best.id ? { id: best.id, n: L.agree.n + 1 } : { id: best.id, n: 1 }; }
            else L.agree = null;
            if (settings.autoSwitch !== false && !L.switched && L.agree && L.agree.n >= CAL.agree && (Date.now() - L.started) / 1000 <= CAL.switchWithin) {
                L.switched = true;
                if (best.id !== P.activeId() && P.setActive(best.id, 'voice')) {
                    status('Recognized ' + whose(P.get(best.id).name) + ' voice. Practicing as ' + P.get(best.id).name + '.');
                }
            }
            // 2. "Ignore them": speech from someone else does not count for the active person.
            {
                var mine = printFor(P.activeId());
                var sMine = mine ? V.cosine(u, mine) : 1;
                // Another enrolled person clearly recognized, or a voice that is not the active
                // person's. In a very loud place the speaker's own voice scores lower too, so only
                // a clearly recognized enrolled voice counts there.
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
        lastGroup = null;
        renderGroup(null);
        if (!consented() || !enrolledIds().length) return;
        var mode = settings.mode === 'group' ? 'group' : 'solo';
        live = { frames: [], since: 0, busy: false, decisions: 0, started: Date.now(), switched: false, mode: mode,
                 timeline: [], hes: [], pauses: [], chunks: [] };
        live.collector = new Collector(onSpeechFrame);
        ensureWorker();
        if (mode === 'group') { status('Group practice: Verba is following who speaks.'); renderLive(live, null); }
        else status(enrolledIds().length > 1 ? 'Listening for whose voice this is…' : '');
    }
    document.addEventListener('verba:session-start', startSession);
    document.addEventListener('verba:hes-counted', function (e) {
        if (!live || !e.detail) return;
        live.hes.push(e.detail.t);
        if (live.mode === 'group') renderLive(live, live.current);
    });
    document.addEventListener('verba:pause-counted', function (e) { if (live && e.detail) live.pauses.push({ t: e.detail.t, d: e.detail.d }); });
    document.addEventListener('verba:chunk', function (e) { if (live && e.detail) live.chunks.push(e.detail); });
    // Group results are worked out before anything else hears that the session ended (a capture
    // listener on window runs first), so the progress panel can save each person's own record.
    window.addEventListener('verba:session-end', function () {
        var L = live;
        lastGroup = L && L.mode === 'group' ? groupResults(L) : null;
    }, true);
    document.addEventListener('verba:session-end', function () {
        live = null;
        renderLive(null);
        renderGroup(lastGroup);
        if (lastGroup) status('');
    });
    document.addEventListener('verba:session-reset', function () { live = null; renderLive(null); });
    window.VerbaMicTap = window.VerbaMicTap || { listeners: [] };
    window.VerbaMicTap.listeners.push(tap);

    function status(text) { var el = $('voiceStatus'); if (el) el.textContent = text; }

    // ── Group practice: each person's own results ──
    var lastGroup = null;   // [{ id, name, talk, words, wpm, fil, fpm, pauses, longPauses, hedges, score, grade, tip }] + extras
    function nameOf(id) { var p = P.get(id); return p ? p.name : 'Removed profile'; }
    function clock(secs) { secs = Math.round(secs); return Math.floor(secs / 60) + ':' + (secs % 60 < 10 ? '0' : '') + (secs % 60); }
    function tipFor(r) {
        if (r.fil >= 2 && r.fpm >= 3) return 'Most to gain: hesitation sounds, about ' + r.fpm + ' a minute. Pause silently instead of saying “um.”';
        if (r.wpm > 165) return 'Slow down a little: ' + r.wpm + ' words a minute is fast for listeners.';
        if (r.wpm > 0 && r.wpm < 110) return 'Pick up the pace a little: ' + r.wpm + ' words a minute.';
        if (r.longPauses) return r.longPauses + ' long pause' + (r.longPauses > 1 ? 's' : '') + '; a short outline helps you keep your place.';
        if (r.hedges >= 3) return r.hedges + ' hedges such as “I think”; state your points directly.';
        return 'Clear and steady. Keep it up.';
    }
    function groupCal(longPause) {
        return { switchCost: CAL.switchCost, unknown: CAL.unknown, longPause: longPause || 3 };
    }
    function groupResults(L) {
        var D = window.VerbaDemo; if (!D) return null;
        var A = V.attribute(L.timeline, { hes: L.hes, pauses: L.pauses, chunks: L.chunks }, groupCal(D.LONG_PAUSE));
        var out = [];
        Object.keys(A.people).forEach(function (id) {
            var p = A.people[id];
            if (id === 'unknown' || !P.get(id) || p.talk < 5) return;
            var wpm = p.talk >= 10 && p.words >= 5 ? Math.round(p.words / p.talk * 60) : 0;
            var r = { id: id, name: nameOf(id), talk: Math.round(p.talk), words: p.words, wpm: wpm, fil: p.fil,
                      fpm: p.talk > 0 ? Math.round(p.fil / (p.talk / 60) * 10) / 10 : 0, pauses: p.pauses, longPauses: p.longPauses, hedges: p.hedges };
            r.score = D.calcScore(r.fil, r.wpm); r.grade = D.scoreGrade(r.score); r.tip = tipFor(r);
            out.push(r);
        });
        if (!out.length) return null;
        out.sort(function (a, b) { return b.talk - a.talk; });
        var unknown = A.people.unknown && A.people.unknown.talk >= 5 ? Math.round(A.people.unknown.talk) : 0;
        // Hand-offs between two recognized people; the gap is known where they took turns in a pause.
        var hand = A.handoffs.filter(function (h) { return h.from !== 'unknown' && h.to !== 'unknown'; });
        var gaps = hand.filter(function (h) { return typeof h.d === 'number'; });
        out.extra = { unknown: unknown, handoffs: hand.length,
                      handoffGap: gaps.length ? Math.round(gaps.reduce(function (s, h) { return s + h.d; }, 0) / gaps.length * 10) / 10 : 0 };
        // Records for each person's progress history: numbers only, like any session.
        out.records = out.map(function (r) {
            return { id: r.id, rec: { t: Date.now(), dur: r.talk, words: r.words, wpm: r.wpm, fil: r.fil, fpm: r.fpm, score: r.score,
                                      pau: r.pauses, lpau: r.longPauses, hed: r.hedges, lang: D.lang(), mode: D.mode() } };
        });
        return out;
    }
    function renderGroup(g) {
        var box = $('groupResults'), cards = $('groupCards'), note = $('groupNote');
        if (!box || !cards) return;
        cards.innerHTML = '';
        if (!g) { box.hidden = true; return; }
        g.forEach(function (r) {
            var card = document.createElement('div'); card.className = 'group-card';
            var head = document.createElement('div'); head.className = 'group-card-head';
            var name = document.createElement('span'); name.className = 'group-name'; name.textContent = r.name;
            var score = document.createElement('span'); score.className = 'group-score'; score.textContent = String(r.score);
            score.style.color = window.VerbaDemo.scoreColor(r.score);
            var grade = document.createElement('span'); grade.className = 'group-grade'; grade.textContent = r.grade;
            head.appendChild(name); head.appendChild(score); head.appendChild(grade);
            var stats = document.createElement('p'); stats.className = 'group-stats';
            stats.textContent = 'Spoke ' + clock(r.talk) + ' \u00b7 ' + r.words + ' words \u00b7 ' + (r.wpm ? r.wpm + ' WPM' : 'pace --') +
                ' \u00b7 ' + r.fil + ' um/uh \u00b7 ' + r.pauses + ' pause' + (r.pauses !== 1 ? 's' : '') + ' \u00b7 ' + r.hedges + ' hedge' + (r.hedges !== 1 ? 's' : '');
            var tip = document.createElement('p'); tip.className = 'group-tip'; tip.textContent = r.tip;
            card.appendChild(head); card.appendChild(stats); card.appendChild(tip);
            cards.appendChild(card);
        });
        var bits = ['Verba followed who was speaking. Each person' + '’' + 's “um”s, pauses and speaking time come from their own turns; their word counts and pace are close estimates.'];
        if (g.extra.handoffs) bits.push(g.extra.handoffs + ' hand-off' + (g.extra.handoffs > 1 ? 's' : '') + ' between speakers' +
            (g.extra.handoffGap ? ', with an average gap of ' + g.extra.handoffGap + ' s.' : '.'));
        if (g.extra.unknown) bits.push('Someone Verba did not recognize spoke for about ' + clock(g.extra.unknown) + '; that is not in anyone' + '’' + 's score.');
        note.textContent = bits.join(' ');
        box.hidden = false;
    }
    // While a group session runs: who is talking now, and each person's time and "um"s so far.
    function renderLive(L, current) {
        var box = $('groupLive');
        if (!box) return;
        box.innerHTML = '';
        if (!L || L.mode !== 'group') { box.hidden = true; return; }
        var A = V.attribute(L.timeline, { hes: L.hes, pauses: [], chunks: [] }, groupCal());
        enrolledIds().forEach(function (id) {
            var p = A.people[id] || { talk: 0, fil: 0 };
            var chip = document.createElement('span');
            chip.className = 'group-chip' + (id === current ? ' speaking' : '');
            chip.textContent = nameOf(id) + ' ' + clock(p.talk) + ' \u00b7 ' + p.fil + ' um/uh';
            box.appendChild(chip);
        });
        box.hidden = false;
        if (current) status('Now speaking: ' + nameOf(current) + '.');
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
            var has = current(prints[p.id]), old = !has && !!prints[p.id], when = has ? new Date(prints[p.id].at) : null;
            info.textContent = p.name + (has ? ': voice saved ' + when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : old ? ': please record again (voice recognition was improved)' : ': no voice yet');
            actions.className = 'voice-actions';
            var rec = document.createElement('button');
            rec.type = 'button'; rec.className = 'share-btn'; rec.textContent = has || old ? 'Record again' : 'Record voice';
            rec.disabled = P.isLocked();
            rec.addEventListener('click', function () { openEnroll(p.id); });
            actions.appendChild(rec);
            if (has || old) {
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

    window.VerbaVoice = { settings: function () { return settings; }, enrolled: enrolledIds, isLive: sessionActive, CAL: CAL,
                          lastGroup: function () { return lastGroup; }, _groupResults: groupResults };
}());
