/* Verba: voice profiles. Tells enrolled voices apart, on this device only.
 *
 * A short stretch of speech is turned into a voiceprint: 80 log-mel filterbank features
 * per 10 ms (computed here, matching Kaldi's fbank), passed through an open speaker-
 * recognition model (WeSpeaker ResNet34-LM, trained on VoxCeleb, CC BY 4.0) that runs in
 * the browser with ONNX Runtime Web. Two voiceprints of the same person point in nearly
 * the same direction, so they are compared by cosine similarity.
 *
 * Nothing leaves the device. The model and runtime are files on this site, downloaded
 * only when someone turns voice profiles on, and voiceprints are kept in this browser.
 *
 * Works as a classic <script> (window.VerbaVoiceID) and from Node for accuracy tests.
 */
var VerbaVoiceID = (function () {
    'use strict';

    var RATE = 16000;
    var FRAME = 400, SHIFT = 160, NFFT = 512, NMEL = 80;

    // ── Resampling to 16 kHz (windowed-sinc low-pass, so higher rates do not alias) ──
    function resample(x, from) {
        if (from === RATE) return Float32Array.from(x);
        var ratio = from / RATE, n = Math.floor(x.length / ratio), y = new Float32Array(n);
        var cutoff = Math.min(1, RATE / from) * 0.95, half = 16;
        for (var i = 0; i < n; i++) {
            var c = i * ratio, k0 = Math.floor(c) - half + 1, acc = 0, wsum = 0;
            for (var k = k0; k < k0 + 2 * half; k++) {
                if (k < 0 || k >= x.length) continue;
                var t = k - c, s = t === 0 ? 1 : Math.sin(Math.PI * cutoff * t) / (Math.PI * cutoff * t);
                var w = 0.5 + 0.5 * Math.cos(Math.PI * t / half);
                acc += x[k] * s * w; wsum += s * w;
            }
            y[i] = wsum ? acc / wsum : 0;
        }
        return y;
    }

    // ── Kaldi-style log-mel filterbank (25 ms Povey window, 10 ms shift, 80 bins from 20 Hz to
    //    7.6 kHz, frames centred on each 10 ms step with mirrored edges), as the model was trained ──
    var tables = null;
    function makeTables() {
        var win = new Float64Array(FRAME);
        for (var i = 0; i < FRAME; i++) win[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)), 0.85);
        var mel = function (f) { return 1127 * Math.log(1 + f / 700); };
        var lo = mel(20), hi = mel(RATE / 2 - 400), delta = (hi - lo) / (NMEL + 1), binW = RATE / NFFT;
        var bank = [];
        for (var b = 0; b < NMEL; b++) {
            var left = lo + b * delta, center = left + delta, right = center + delta, first = -1, w = [];
            for (var j = 0; j < NFFT / 2; j++) {
                var m = mel(binW * j);
                if (m > left && m < right) {
                    if (first < 0) first = j;
                    w.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
                }
            }
            bank.push({ first: first, w: w });
        }
        var cos = new Float64Array(NFFT / 2), sin = new Float64Array(NFFT / 2);
        for (var q = 0; q < NFFT / 2; q++) { cos[q] = Math.cos(-2 * Math.PI * q / NFFT); sin[q] = Math.sin(-2 * Math.PI * q / NFFT); }
        var rev = new Uint16Array(NFFT);
        for (var r = 0, bits = Math.log(NFFT) / Math.LN2; r < NFFT; r++) {
            var v = 0; for (var bb = 0; bb < bits; bb++) v |= ((r >> bb) & 1) << (bits - 1 - bb); rev[r] = v;
        }
        return { win: win, bank: bank, cos: cos, sin: sin, rev: rev };
    }
    function fft(re, im, T) {
        var n = NFFT, i, j, t;
        for (i = 0; i < n; i++) { j = T.rev[i]; if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
        for (var len = 2; len <= n; len <<= 1) {
            var half = len >> 1, step = n / len;
            for (i = 0; i < n; i += len) for (var k = 0; k < half; k++) {
                var a = i + k, b = a + half, wr = T.cos[k * step], wi = T.sin[k * step];
                var tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            }
        }
    }
    // samples: 16 kHz, -1..1. Returns { data: Float32Array(frames * 80), frames }.
    function fbank(samples) {
        var T = tables || (tables = makeTables());
        var N = samples.length, frames = N < FRAME ? 0 : Math.floor((N + SHIFT / 2) / SHIFT);
        var out = new Float32Array(frames * NMEL), re = new Float64Array(NFFT), im = new Float64Array(NFFT), pw = new Float64Array(NFFT / 2);
        for (var f = 0; f < frames; f++) {
            var o = f * SHIFT + SHIFT / 2 - FRAME / 2, mean = 0, i;
            for (i = 0; i < FRAME; i++) {
                var k = o + i;
                while (k < 0 || k >= N) k = k < 0 ? -k - 1 : 2 * N - 1 - k;
                re[i] = samples[k] * 32768;     // the model expects 16-bit scale
                mean += re[i];
            }
            mean /= FRAME;
            for (i = 0; i < FRAME; i++) re[i] -= mean;
            for (i = FRAME - 1; i > 0; i--) re[i] -= 0.97 * re[i - 1];
            re[0] -= 0.97 * re[0];
            for (i = 0; i < FRAME; i++) re[i] *= T.win[i];
            for (i = FRAME; i < NFFT; i++) re[i] = 0;
            for (i = 0; i < NFFT; i++) im[i] = 0;
            fft(re, im, T);
            for (i = 0; i < NFFT / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
            for (var b = 0; b < NMEL; b++) {
                var bk = T.bank[b], e = 0;
                for (var j = 0; j < bk.w.length; j++) e += bk.w[j] * pw[bk.first + j];
                out[f * NMEL + b] = Math.log(Math.max(e, 1.1920929e-7));
            }
        }
        return { data: out, frames: frames };
    }

    function cosine(a, b) {
        var d = 0, na = 0, nb = 0;
        for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        return na && nb ? d / Math.sqrt(na * nb) : 0;
    }
    function normalize(v) {
        var n = 0, i; for (i = 0; i < v.length; i++) n += v[i] * v[i];
        n = Math.sqrt(n) || 1; var out = new Float32Array(v.length); for (i = 0; i < v.length; i++) out[i] = v[i] / n;
        return out;
    }
    // Average of several voiceprints (each normalised first), for enrollment.
    function average(list) {
        if (!list.length) return null;
        var sum = new Float32Array(list[0].length);
        list.forEach(function (v) { var u = normalize(v); for (var i = 0; i < u.length; i++) sum[i] += u[i]; });
        return normalize(sum);
    }

    // ── The model (loaded on first use) ──
    var session = null, loading = null;
    function load(ort, modelUrl) {
        if (session) return Promise.resolve(session);
        if (loading) return loading;
        loading = ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
            .then(function (s) { session = s; return s; }, function (e) { loading = null; throw e; });
        return loading;
    }
    // samples at 16 kHz -> Float32Array voiceprint (256 values), or null if too short.
    function embed(ort, samples) {
        var fb = fbank(samples);
        if (fb.frames < 50) return Promise.resolve(null);
        var input = new ort.Tensor('float32', fb.data, [1, fb.frames, NMEL]);
        var feeds = {}; feeds[session.inputNames[0]] = input;
        return session.run(feeds).then(function (r) { return Float32Array.from(r[session.outputNames[0]].data); });
    }

    return { RATE: RATE, resample: resample, fbank: fbank, cosine: cosine, normalize: normalize, average: average, load: load, embed: embed,
             isLoaded: function () { return !!session; } };
}());

if (typeof window !== 'undefined') window.VerbaVoiceID = VerbaVoiceID;
if (typeof module !== 'undefined' && module.exports) module.exports = VerbaVoiceID;
