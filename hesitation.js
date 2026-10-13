/* Verba: hesitation sound detector ("um", "uh", "euh", "äh", ...).
 *
 * Browser speech recognition drops most filled pauses from its transcript, so this
 * detector works on the raw microphone signal instead. A filled pause is a held,
 * voiced sound with an almost constant pitch and a steady vowel quality, lasting a few
 * hundred milliseconds. Ordinary words change pitch and vowel quality far more quickly.
 * (Approach after Goto, Itou & Hayamizu, "A real-time filled pause detection system
 * for spontaneous speech recognition", Eurospeech 1999.)
 *
 * Vowel quality is measured with an LPC cepstrum, which follows the shape of the vocal
 * tract and ignores the pitch harmonics, so a held sound still counts when its pitch
 * drifts. The decision looks at a sliding window, so a hesitation that runs straight on
 * from a word ("so-uhh") is found as well as one that stands alone.
 *
 * Everything runs locally. Audio never leaves the device.
 *
 * The same file is used three ways:
 *   - as an AudioWorklet module (registers the "verba-hesitation" processor),
 *   - as a classic <script> (exposes window.VerbaHesitationDetector), and
 *   - from Node for offline accuracy tests (module.exports).
 */
var VerbaHesitationDetector = (function () {
    'use strict';

    // Tuned on Whisper-aligned conversational speech (DisfluencySpeech validation split)
    // and checked on the held-out test split, favouring precision: a wrong buzz is worse
    // than a missed one.
    var DEFAULTS = {
        window: 0.30,           // seconds of steady voicing before a hesitation is reported
        minEnergyDb: 10,        // dB above the noise floor to count as voiced sound
        maxAperiodicity: 0.35,  // YIN threshold: lower means more strictly periodic (voiced)
        maxPitchRange: 4.5,     // semitones of pitch range allowed inside the window
        maxPitchStep: 1.5,      // semitones of pitch change allowed over 50 ms
        maxPitchJump: 3,        // a bigger jump between two frames is a pitch-tracking error
        maxVowelChange: 4,      // cepstral distance (dB) allowed over 50 ms
        maxVowelDrift: 5,       // cepstral distance (dB) allowed from start to end of the window
        minStableFraction: 0.9, // share of frames in the window that must be steady
        glitchFrames: 3,        // consecutive unvoiced frames tolerated inside one sound
        minF0: 70,
        maxF0: 420,
        // Pauses: silence between two stretches of speech.
        pauseSpeechDb: 14,      // dB above the noise floor that counts as speaking
        pauseSilenceDb: 8,      // dB above the noise floor below which it is silent
        minPause: 0.5,          // seconds of silence reported as a pause
        // Noise mode: switched on only while the background is loud compared with the voice
        // (a fan, a cafe, music). In a quiet room none of these settings are used. Tuned on the
        // validation split mixed with fan noise, six-talker babble and music, 10 to 20 dB below
        // the voice, and checked on the test split.
        noisyBelowDb: 26,       // voice less than this many dB above the background: noise mode on
        quietAboveDb: 30,       // voice more than this many dB above it again: noise mode off
        switchSeconds: 1,       // the condition has to hold this long before the mode changes
        noisyVoicedAp: 0.45,    // pauses: a voiced frame this periodic counts as speaking...
        noisyVoicedShare: 0.7,  // ...when it is this share of the voice level above the background
        noisyLoudShare: 0.75,   // pauses: any frame this share of the voice level above it is speaking
        noisyOnsetFrames: 3,    // pauses: frames of speech needed to end a pause
        noisyMinPause: 1.0,     // pauses: in noise, shorter gaps cannot be told apart from quiet speech
        noisyEdgeTrim: 0.1,     // pauses: seconds taken off, for the quiet word ends counted as silence
        noisyEnergyShare: 0.75, // um/uh: a held sound must reach this share of the voice level
        noisyMaxVowelChange: 3.5,
        noisyMaxAperiodicity: 0.35,
        noisyMinStableFraction: 0.9
    };

    var SILENT_DB = -100;       // frames this quiet are digital silence (a muted or starting stream)
    var FLOOR_SECONDS = 6;      // the noise floor is a low percentile of this much recent audio
    var LAG = 5;                // frames back (50 ms at a 10 ms hop) for the change measures
    var NCEP = 12;              // cepstral coefficients used for vowel quality

    function Detector(sampleRate, options) {
        var o = {};
        var key;
        for (key in DEFAULTS) o[key] = DEFAULTS[key];
        if (options) for (key in options) if (Object.prototype.hasOwnProperty.call(options, key)) o[key] = options[key];
        this.opts = o;

        // Decimate to roughly 16 kHz; plenty for pitch and the vowel spectrum.
        this.dec = Math.max(1, Math.round(sampleRate / 16000));
        this.fs = sampleRate / this.dec;
        this.hop = Math.round(0.010 * this.fs);
        this.win = Math.round(0.032 * this.fs);
        this.yinW = Math.round(0.025 * this.fs);
        this.tauMin = Math.floor(this.fs / o.maxF0);
        this.tauMax = Math.ceil(this.fs / o.minF0);
        this.bufLen = Math.max(this.win + 1, this.yinW + this.tauMax + 2);
        this.ring = new Float32Array(this.bufLen);
        this.ringPos = 0;
        this.buf = new Float32Array(this.bufLen);
        this.bufFill = 0;
        this.sinceHop = 0;
        this.decAcc = 0;
        this.decCount = 0;

        this.hann = new Float64Array(this.win);
        for (var i = 0; i < this.win; i++) this.hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.win - 1));
        this.yinD = new Float64Array(this.tauMax + 2);
        this.order = Math.min(20, Math.round(this.fs / 1000) + 2);
        this.xw = new Float64Array(this.win);
        this.ac = new Float64Array(this.order + 1);
        this.lpc = new Float64Array(this.order + 1);
        this.lpcTmp = new Float64Array(this.order + 1);

        this.levels = new Float32Array(Math.round(FLOOR_SECONDS * 100));
        this.levelCount = 0;
        this.levelPos = 0;
        this.noiseDb = null;    // unknown until a frame that is not digital silence arrives
        this.silentRing = new Uint8Array(this.levels.length);   // which recent frames were digital silence
        this.silentPos = 0;
        this.silentCount = 0;

        this.frames = 0;
        this.time = 0;          // seconds of audio processed
        this.recent = [];       // cepstra of the last LAG + 1 frames
        this.run = null;
        this.resetRun();
        this.onDetect = null;
        this.onPause = null;    // called with the pause length in seconds when speech resumes
        this.onLevel = null;    // called every 250 ms with the loudest frame (dBFS) and the noise floor
        this.levelMax = -Infinity;
        this.heardSpeech = false;
        this.silentFrames = 0;
        this.onsetFrames = 0;
        this.voiceDb = null;    // running level of the speaker's voiced sounds
        this.snr = null;        // voice level above the noise floor, in dB
        this.noisy = false;     // noise mode
        this.switchCount = 0;
    }

    Detector.prototype.resetRun = function () {
        this.run = { frames: [], bad: 0, lastSt: null, emitted: false };
    };

    // Feed any number of samples (Float32Array or array) at the original sample rate.
    Detector.prototype.process = function (samples) {
        var dec = this.dec;
        for (var i = 0; i < samples.length; i++) {
            this.decAcc += samples[i];
            if (++this.decCount < dec) continue;
            var v = this.decAcc / dec;
            this.decAcc = 0;
            this.decCount = 0;
            this.ring[this.ringPos] = v;
            this.ringPos = (this.ringPos + 1) % this.bufLen;
            if (this.bufFill < this.bufLen) this.bufFill++;
            if (++this.sinceHop >= this.hop) {
                this.sinceHop = 0;
                if (this.bufFill === this.bufLen) {
                    // Unroll the ring into a contiguous frame, oldest sample first.
                    var tail = this.bufLen - this.ringPos;
                    this.buf.set(this.ring.subarray(this.ringPos), 0);
                    this.buf.set(this.ring.subarray(0, this.ringPos), tail);
                    this.analyze();
                }
            }
        }
    };

    // Noise floor: the 5th percentile of the last few seconds, ignoring digital silence,
    // so a stream that starts with zeros (common while a microphone wakes up) or a burst
    // of loud speech cannot leave it stuck too low or too high.
    Detector.prototype.updateFloor = function (db) {
        var silent = db <= SILENT_DB ? 1 : 0;
        this.silentCount += silent - this.silentRing[this.silentPos];
        this.silentRing[this.silentPos] = silent;
        this.silentPos = (this.silentPos + 1) % this.silentRing.length;
        if (silent) return;
        var lv = this.levels;
        lv[this.levelPos] = db;
        this.levelPos = (this.levelPos + 1) % lv.length;
        if (this.levelCount < lv.length) this.levelCount++;
        if (this.noiseDb === null || this.frames % 10 === 0) {
            var sorted = Array.prototype.slice.call(lv.subarray(0, this.levelCount)).sort(function (a, b) { return a - b; });
            this.noiseDb = sorted[Math.floor(this.levelCount * 0.05)];
        } else if (db < this.noiseDb) {
            this.noiseDb = db;
        }
    };

    // Measure one 10 ms frame: loudness, pitch, periodicity, and vowel quality.
    Detector.prototype.analyze = function () {
        var buf = this.buf, n = this.bufLen, i, j, k;
        this.frames++;
        this.time = this.frames * this.hop / this.fs;

        var start = n - this.win, sum = 0;
        for (i = start; i < n; i++) sum += buf[i] * buf[i];
        var db = 10 * Math.log10(sum / this.win + 1e-12);
        this.updateFloor(db);

        if (db > this.levelMax) this.levelMax = db;
        if (this.frames % 25 === 0) {
            if (this.onLevel) this.onLevel(this.levelMax, this.noiseDb, this.noisy);
            this.levelMax = -Infinity;
        }

        // Pitch by YIN (de Cheveigné & Kawahara, 2002).
        var W = this.yinW, tauMax = this.tauMax, d = this.yinD;
        var base = n - W - tauMax - 1, tau, acc, diff;
        var running = 0, best = -1, bestVal = 1e9;
        d[0] = 1;
        for (tau = 1; tau <= tauMax; tau++) {
            acc = 0;
            for (j = 0; j < W; j++) {
                diff = buf[base + j] - buf[base + j + tau];
                acc += diff * diff;
            }
            running += acc;
            d[tau] = running > 0 ? acc * tau / running : 1;
        }
        for (tau = this.tauMin; tau <= tauMax; tau++) {
            if (d[tau] < 0.15) {
                while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
                best = tau; bestVal = d[tau];
                break;
            }
            if (d[tau] < bestVal) { bestVal = d[tau]; best = tau; }
        }
        var f0 = 0;
        if (best > 0) {
            var t = best;
            if (t > 1 && t < tauMax) {
                var p = d[t - 1], q = d[t], r = d[t + 1], den = p - 2 * q + r;
                if (den !== 0) t = t + 0.5 * (p - r) / den;
            }
            f0 = this.fs / t;
        }

        // Vowel quality: LPC cepstrum of the pre-emphasised, windowed frame.
        var win = this.win, xw = this.xw, ord = this.order, ac = this.ac, a = this.lpc, tmp = this.lpcTmp;
        for (i = 0; i < win; i++) xw[i] = (buf[start + i] - 0.97 * buf[start + i - 1]) * this.hann[i];
        for (k = 0; k <= ord; k++) {
            var s = 0;
            for (i = k; i < win; i++) s += xw[i] * xw[i - k];
            ac[k] = s;
        }
        var cep = new Float64Array(NCEP + 1);
        if (ac[0] > 1e-10) {
            ac[0] *= 1.0001;    // a touch of white noise keeps the recursion stable
            for (i = 0; i <= ord; i++) a[i] = 0;
            a[0] = 1;
            var err = ac[0];
            for (i = 1; i <= ord; i++) {
                var sacc = ac[i];
                for (j = 1; j < i; j++) sacc += a[j] * ac[i - j];
                var refl = -sacc / err;
                for (j = 0; j <= ord; j++) tmp[j] = a[j];
                for (j = 1; j < i; j++) a[j] = tmp[j] + refl * tmp[i - j];
                a[i] = refl;
                err *= (1 - refl * refl);
                if (err <= 0) break;
            }
            for (var m = 1; m <= NCEP; m++) {
                var c = m <= ord ? -a[m] : 0;
                for (k = Math.max(1, m - ord); k < m; k++) c -= (k / m) * cep[k] * a[m - k];
                cep[m] = c;
            }
        }
        var recent = this.recent;
        recent.push(cep);
        if (recent.length > LAG + 1) recent.shift();
        var vowelChange = recent.length === LAG + 1 ? cepDistance(cep, recent[0]) : Infinity;

        var frame = { t: this.time, db: db, noiseDb: this.noiseDb, ap: bestVal, f0: f0, cep: cep, vowelChange: vowelChange };
        this.trackBackground(frame);
        this.trackPause(frame);
        this.decide(frame);
    };

    // How loud the background is compared with the voice, and whether noise mode is on.
    Detector.prototype.trackBackground = function (fr) {
        var o = this.opts;
        if (fr.noiseDb === null) return;
        if (fr.f0 >= o.minF0 && fr.f0 <= o.maxF0 && fr.ap < 0.25 && fr.db > fr.noiseDb + 6) {
            this.voiceDb = this.voiceDb === null ? fr.db : this.voiceDb + 0.02 * (fr.db - this.voiceDb);
        }
        if (this.voiceDb === null) return;
        this.snr = this.voiceDb - fr.noiseDb;
        // A room with background noise never gives exact digital silence. A microphone that
        // does (a noise gate, or one still waking up) has no background at all, even though
        // the floor is then measured on quiet speech.
        var gated = this.silentCount >= 10;
        var want = !gated && (this.noisy ? this.snr <= o.quietAboveDb : this.snr < o.noisyBelowDb);
        if (want === this.noisy) { this.switchCount = 0; return; }
        if (++this.switchCount >= o.switchSeconds * this.fs / this.hop) {
            this.noisy = want;
            this.switchCount = 0;
        }
    };

    // Distance between two spectral envelopes, in dB.
    function cepDistance(x, y) {
        var s = 0;
        for (var i = 1; i <= NCEP; i++) { var dd = x[i] - y[i]; s += dd * dd; }
        return 4.3429 * Math.sqrt(2 * s);
    }

    // Report each silence between two stretches of speech once speech resumes.
    Detector.prototype.trackPause = function (fr) {
        var o = this.opts;
        if (fr.noiseDb === null || fr.db <= SILENT_DB) {
            // Digital silence: nothing is arriving from the microphone, so it is silent.
            if (this.heardSpeech) this.silentFrames++;
            return;
        }
        var above = fr.db - fr.noiseDb;
        if (this.noisy) {
            // In noise, loudness alone cannot tell quiet speech from the background, so
            // speaking means a voiced sound well above it, or anything close to voice level.
            var speaking = (fr.f0 >= o.minF0 && fr.f0 <= o.maxF0 && fr.ap < o.noisyVoicedAp &&
                            above > Math.max(6, o.noisyVoicedShare * this.snr)) || above > o.noisyLoudShare * this.snr;
            if (!speaking) {
                this.onsetFrames = 0;
                if (this.heardSpeech) this.silentFrames++;
                return;
            }
            if (++this.onsetFrames < o.noisyOnsetFrames) {
                if (this.heardSpeech) this.silentFrames++;
                return;
            }
            var quiet = (this.silentFrames - (o.noisyOnsetFrames - 1)) * this.hop / this.fs - o.noisyEdgeTrim;
            if (this.heardSpeech && quiet >= o.noisyMinPause && this.onPause) this.onPause(quiet, fr.t);
            this.heardSpeech = true;
            this.silentFrames = 0;
            return;
        }
        this.onsetFrames = 0;
        if (above >= o.pauseSpeechDb && fr.db > -85) {
            var secs = this.silentFrames * this.hop / this.fs;
            if (this.heardSpeech && secs >= o.minPause && this.onPause) this.onPause(secs, fr.t);
            this.heardSpeech = true;
            this.silentFrames = 0;
        } else if (above < o.pauseSilenceDb) {
            if (this.heardSpeech) this.silentFrames++;
        }
        // In between the two thresholds: neither clearly speech nor clearly silent; keep counting.
        else if (this.heardSpeech && this.silentFrames > 0) {
            this.silentFrames++;
        }
    };

    // Decide, frame by frame, whether a held hesitation sound is in progress.
    Detector.prototype.decide = function (fr) {
        var o = this.opts, run = this.run, frames = run.frames;
        // In noise mode a held sound has to be near the speaker's own level, so a hum or a
        // voice in the background is not taken for the speaker's "um".
        var noisy = this.noisy;
        var minEnergy = noisy ? Math.max(o.minEnergyDb, o.noisyEnergyShare * this.snr) : o.minEnergyDb;
        var maxAp = noisy ? o.noisyMaxAperiodicity : o.maxAperiodicity;
        var maxChange = noisy ? o.noisyMaxVowelChange : o.maxVowelChange;
        var minStable = noisy ? o.noisyMinStableFraction : o.minStableFraction;
        var voiced = fr.noiseDb !== null && fr.db > fr.noiseDb + minEnergy && fr.db > -85 &&
            fr.f0 >= o.minF0 && fr.f0 <= o.maxF0 && fr.ap < maxAp;
        var st = voiced ? 12 * Math.log(fr.f0 / 100) / Math.LN2 : 0;
        if (voiced && run.lastSt !== null && Math.abs(st - run.lastSt) > o.maxPitchJump) {
            // An octave error is folded back; any other sudden jump is a tracking glitch.
            if (Math.abs(st - 12 - run.lastSt) <= o.maxPitchJump) st -= 12;
            else if (Math.abs(st + 12 - run.lastSt) <= o.maxPitchJump) st += 12;
            else voiced = false;
        }
        var W = Math.round(o.window * this.fs / this.hop);
        if (!voiced) {
            if (frames.length && ++run.bad > o.glitchFrames) this.resetRun();
            else if (frames.length) { frames.push(null); if (frames.length > W) frames.shift(); }
            return;
        }
        run.bad = 0;
        run.lastSt = st;
        var back = frames.length >= LAG ? frames[frames.length - LAG] : null;
        var steady = fr.vowelChange <= maxChange && !(back && Math.abs(back.st - st) > o.maxPitchStep);
        frames.push({ st: st, steady: steady, cep: fr.cep });
        if (frames.length > W) frames.shift();
        if (run.emitted || frames.length < W) return;

        var lo = Infinity, hi = -Infinity, nSteady = 0, first = null, last = null;
        for (var i = 0; i < frames.length; i++) {
            var e = frames[i];
            if (!e) continue;
            if (e.st < lo) lo = e.st;
            if (e.st > hi) hi = e.st;
            if (e.steady) nSteady++;
            if (!first) first = e;
            last = e;
        }
        if (hi - lo <= o.maxPitchRange && nSteady / W >= minStable &&
            cepDistance(first.cep, last.cep) <= o.maxVowelDrift) {
            run.emitted = true;
            if (this.onDetect) this.onDetect(fr.t);
        }
    };

    Detector.DEFAULTS = DEFAULTS;
    return Detector;
}());

if (typeof registerProcessor === 'function') {
    class VerbaHesitationProcessor extends AudioWorkletProcessor {
        constructor() {
            super();
            var port = this.port;
            this.detector = new VerbaHesitationDetector(sampleRate);
            this.detector.onDetect = function (t) { port.postMessage({ type: 'hesitation', t: t }); };
            this.detector.onPause = function (d) { port.postMessage({ type: 'pause', d: d }); };
            this.detector.onLevel = function (db, floor, noisy) { port.postMessage({ type: 'level', db: db, floor: floor, noisy: noisy }); };
        }
        process(inputs) {
            var input = inputs[0];
            if (input && input[0]) this.detector.process(input[0]);
            return true;
        }
    }
    registerProcessor('verba-hesitation', VerbaHesitationProcessor);
} else if (typeof window !== 'undefined') {
    window.VerbaHesitationDetector = VerbaHesitationDetector;
}
if (typeof module !== 'undefined' && module.exports) module.exports = VerbaHesitationDetector;
