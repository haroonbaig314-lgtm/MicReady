// Synthetic speech-like signals for detector tests (no recordings needed).
// A voiced sound is a glottal pulse train filtered by three formant resonators.

function resonator(x, fs, freq, bw) {
    var r = Math.exp(-Math.PI * bw / fs), th = 2 * Math.PI * freq / fs;
    var a1 = 2 * r * Math.cos(th), a2 = -r * r, g = 1 - r;
    var y = new Float32Array(x.length), y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) { var v = g * x[i] + a1 * y1 + a2 * y2; y[i] = v; y2 = y1; y1 = v; }
    return y;
}

// f0 may be a number or a function of time (seconds); formants is [F1, F2, F3].
function vowel(fs, seconds, f0, formants, amp) {
    var n = Math.round(fs * seconds), src = new Float32Array(n), phase = 0;
    for (var i = 0; i < n; i++) {
        var f = typeof f0 === 'function' ? f0(i / fs) : f0;
        phase += f / fs;
        if (phase >= 1) { phase -= 1; src[i] = 1; }
    }
    var out = new Float32Array(n);
    [[formants[0], 90], [formants[1], 110], [formants[2], 160]].forEach(function (fb, k) {
        var y = resonator(src, fs, fb[0], fb[1]);
        for (var i = 0; i < n; i++) out[i] += y[i] * [1, 0.6, 0.3][k];
    });
    var peak = 0;
    for (var i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    var ramp = Math.round(fs * 0.02);
    for (var j = 0; j < n; j++) {
        var env = Math.min(1, j / ramp, (n - 1 - j) / ramp);
        out[j] = out[j] / peak * amp * env;
    }
    return out;
}

function silence(fs, seconds) { return new Float32Array(Math.round(fs * seconds)); }

function noise(fs, seconds, amp, seed) {
    var s = seed || 1, x = new Float32Array(Math.round(fs * seconds));
    for (var i = 0; i < x.length; i++) { s = (s * 16807) % 2147483647; x[i] = (s / 2147483647 * 2 - 1) * amp; }
    return x;
}

// Fluent-sounding syllables: short vowels whose pitch and formants keep moving.
var VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [530, 1840, 2480], [300, 870, 2240], [660, 1720, 2410]];
function syllables(fs, count, seed) {
    var parts = [], s = seed || 3;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (var i = 0; i < count; i++) {
        var start = 110 + rnd() * 60, slope = (rnd() - 0.5) * 300;
        parts.push(vowel(fs, 0.14 + rnd() * 0.06, function (t) { return start + slope * t; }, VOWELS[i % VOWELS.length], 0.4));
        parts.push(silence(fs, 0.03));
    }
    return concat(parts);
}

function concat(parts) {
    var n = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Float32Array(n), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
}

function addNoise(x, amp, seed) {
    var nz = noise(1, x.length, amp, seed);
    for (var i = 0; i < x.length; i++) x[i] += nz[i];
    return x;
}

// 16-bit mono WAV, for feeding Chromium's fake microphone.
function toWav(x, fs) {
    var buf = Buffer.alloc(44 + x.length * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(fs, 24); buf.writeUInt32LE(fs * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(x.length * 2, 40);
    for (var i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
    return buf;
}

module.exports = { vowel: vowel, silence: silence, noise: noise, syllables: syllables, concat: concat, addNoise: addNoise, toWav: toWav, SCHWA: [500, 1500, 2500] };
