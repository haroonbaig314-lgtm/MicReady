/* Verba: hesitation sound detector ("um", "uh", "euh", "äh", ...).
 *
 * Browser speech recognition drops most filled pauses from its transcript, so this
 * detector works on the raw microphone signal instead. A filled pause is a held,
 * voiced sound with an almost constant pitch and a steady spectrum, lasting a few
 * hundred milliseconds. Ordinary words change pitch and spectrum far more quickly.
 * (Approach after Goto, Itou & Hayamizu, "A real-time filled pause detection system
 * for spontaneous speech recognition", Eurospeech 1999.)
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

    // Tuned on Whisper-aligned conversational speech (DisfluencySpeech validation split),
    // favouring precision: a wrong buzz is worse than a missed one.
    var DEFAULTS = {
        minDuration: 0.30,      // seconds of steady voicing before a hesitation is reported
        minEnergyDb: 16,        // dB above the running noise floor to count as speech
        maxAperiodicity: 0.35,  // YIN threshold: lower means more strictly periodic (voiced)
        maxPitchStep: 1.0,      // semitones of pitch change allowed over 50 ms
        maxPitchRange: 3.5,     // semitones of pitch range allowed over the whole sound
        maxSpectralChange: 4.0, // mean dB change of the spectral envelope over 50 ms
        minStableFraction: 0.75,// share of frames that must have a steady spectrum
        glitchFrames: 5,        // consecutive bad frames tolerated inside one sound
        minF0: 70,
        maxF0: 420
    };

    function nextPow2(n) { var p = 1; while (p < n) p <<= 1; return p; }

    // In-place radix-2 FFT.
    function fft(re, im) {
        var n = re.length, i, j, k, len, half, step, ang, wr, wi, tr, ti, cr, ci, t;
        for (i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (len = 2; len <= n; len <<= 1) {
            half = len >> 1;
            ang = -2 * Math.PI / len;
            step = { r: Math.cos(ang), i: Math.sin(ang) };
            for (i = 0; i < n; i += len) {
                wr = 1; wi = 0;
                for (k = 0; k < half; k++) {
                    var a = i + k, b = a + half;
                    tr = re[b] * wr - im[b] * wi;
                    ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr; im[a] += ti;
                    cr = wr * step.r - wi * step.i;
                    ci = wr * step.i + wi * step.r;
                    wr = cr; wi = ci;
                }
            }
        }
    }

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
        this.bufLen = Math.max(this.win, this.yinW + this.tauMax + 2);
        this.ring = new Float32Array(this.bufLen);
        this.ringPos = 0;
        this.buf = new Float32Array(this.bufLen);
        this.bufFill = 0;
        this.sinceHop = 0;
        this.decAcc = 0;
        this.decCount = 0;

        this.nfft = nextPow2(this.win);
        this.re = new Float64Array(this.nfft);
        this.im = new Float64Array(this.nfft);
        this.hann = new Float64Array(this.win);
        for (var i = 0; i < this.win; i++) this.hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.win - 1));
        this.yinD = new Float64Array(this.tauMax + 2);

        // Log-spaced bands from 150 Hz to 4 kHz describe the spectral envelope.
        var nb = 20, lo = 150, hi = Math.min(4000, this.fs / 2 - 100);
        this.bandEdges = [];
        for (var b = 0; b <= nb; b++) {
            var f = lo * Math.pow(hi / lo, b / nb);
            this.bandEdges.push(Math.max(1, Math.round(f * this.nfft / this.fs)));
        }
        this.history = [];      // spectral envelopes of recent frames
        this.pitchHist = [];    // { st, voiced } of recent frames
        this.histMax = 6;       // 6 frames = 50 ms back at a 10 ms hop

        this.noiseDb = null;
        this.frames = 0;
        this.time = 0;          // seconds of audio processed
        this.resetRun();
        this.onDetect = null;
    }

    Detector.prototype.resetRun = function () {
        this.run = { len: 0, stable: 0, bad: 0, stMin: Infinity, stMax: -Infinity, emitted: false };
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

    // Measure one 10 ms frame: loudness, pitch, periodicity, and spectral change.
    Detector.prototype.analyze = function () {
        var buf = this.buf, n = this.bufLen, i;
        this.frames++;
        this.time = this.frames * this.hop / this.fs;

        var start = n - this.win, sum = 0;
        for (i = start; i < n; i++) sum += buf[i] * buf[i];
        var db = 10 * Math.log10(sum / this.win + 1e-12);
        if (this.noiseDb === null) this.noiseDb = db;
        if (db < this.noiseDb) this.noiseDb = 0.7 * this.noiseDb + 0.3 * db;
        else this.noiseDb += 0.004; // slow rise: about 0.4 dB per second

        // Pitch by YIN (de Cheveigné & Kawahara, 2002).
        var W = this.yinW, tauMax = this.tauMax, d = this.yinD;
        var base = n - W - tauMax - 1, tau, j, acc, diff;
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

        // Spectral envelope: log energies in log-spaced bands.
        var win = this.win, re = this.re, im = this.im;
        for (i = 0; i < this.nfft; i++) {
            re[i] = i < win ? buf[start + i] * this.hann[i] : 0;
            im[i] = 0;
        }
        fft(re, im);
        var edges = this.bandEdges, bands = new Float64Array(edges.length - 1), bI;
        for (bI = 0; bI < bands.length; bI++) {
            var e = 0;
            for (i = edges[bI]; i < Math.max(edges[bI] + 1, edges[bI + 1]); i++) e += re[i] * re[i] + im[i] * im[i];
            bands[bI] = 10 * Math.log10(e + 1e-12);
        }
        var hist = this.history, specChange = Infinity;
        if (hist.length >= this.histMax - 1) {
            var s = 0, past = hist[0];
            for (bI = 0; bI < bands.length; bI++) s += Math.abs(bands[bI] - past[bI]);
            specChange = s / bands.length;
        }
        hist.push(bands);
        if (hist.length > this.histMax - 1) hist.shift();

        this.decide({ t: this.time, db: db, noiseDb: this.noiseDb, ap: bestVal, f0: f0, specChange: specChange });
    };

    // Decide, frame by frame, whether a held hesitation sound is in progress.
    Detector.prototype.decide = function (fr) {
        var o = this.opts;
        var speech = fr.db > fr.noiseDb + o.minEnergyDb && fr.db > -70;
        var voiced = speech && fr.f0 >= o.minF0 && fr.f0 <= o.maxF0 && fr.ap < o.maxAperiodicity;
        var st = voiced ? 12 * Math.log(fr.f0 / 100) / Math.LN2 : 0;

        var ph = this.pitchHist;
        var past = ph.length >= this.histMax - 1 ? ph[0] : null;
        var pitchStep = voiced && past && past.voiced ? Math.abs(st - past.st) : 0;
        ph.push({ st: st, voiced: voiced });
        if (ph.length > this.histMax - 1) ph.shift();

        var run = this.run;
        if (voiced && pitchStep <= o.maxPitchStep) {
            var stMin = Math.min(run.stMin, st), stMax = Math.max(run.stMax, st);
            if (run.len > 0 && stMax - stMin > o.maxPitchRange) {
                this.resetRun();
                run = this.run;
                stMin = st; stMax = st;
            }
            run.len++;
            run.bad = 0;
            run.stMin = stMin; run.stMax = stMax;
            if (fr.specChange <= o.maxSpectralChange) run.stable++;
        } else {
            if (run.len > 0 && ++run.bad > o.glitchFrames) this.resetRun();
            return;
        }

        var dur = run.len * this.hop / this.fs;
        if (!run.emitted && dur >= o.minDuration && run.stable / run.len >= o.minStableFraction) {
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
