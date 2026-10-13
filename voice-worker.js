/* Verba: computes voiceprints in the background so the page stays responsive.
 * Messages in:  { type: 'init', base }            load the runtime and the voice model
 *               { type: 'embed', id, samples }    16 kHz audio -> voiceprint
 * Messages out: { type: 'ready' } | { type: 'error', message } | { type: 'emb', id, v }
 */
importScripts('voiceid.js', 'vendor/ort/ort.wasm.min.js');

var ready = null;
self.onmessage = function (e) {
    var m = e.data || {};
    if (m.type === 'init' && !ready) {
        // The loader is named .js (not .mjs) so any host serves it with a JavaScript type.
        ort.env.wasm.wasmPaths = { mjs: m.base + 'vendor/ort/ort-wasm-simd-threaded.module.js', wasm: m.base + 'vendor/ort/ort-wasm-simd-threaded.wasm' };
        ort.env.wasm.numThreads = 1;      // no shared memory on a static host
        ready = VerbaVoiceID.load(ort, m.base + 'models/voice-resnet34.onnx');
        ready.then(function () { self.postMessage({ type: 'ready' }); },
                   function (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); });
    } else if (m.type === 'embed' && ready) {
        ready.then(function () { return VerbaVoiceID.embed(ort, m.samples); })
            .then(function (v) { self.postMessage({ type: 'emb', id: m.id, v: v }, v ? [v.buffer] : []); })
            .catch(function (err) { self.postMessage({ type: 'emb', id: m.id, v: null, error: String(err) }); });
    }
};
