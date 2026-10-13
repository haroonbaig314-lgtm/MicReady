// Static file server for the tests. Mirrors GitHub Pages: gzip for text files
// and a short cache lifetime.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.resolve(__dirname, '..');
const port = +(process.argv[2] || 4173);
const types = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
    '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.wav': 'audio/wav'
};
http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
    }
    const type = types[path.extname(file)] || 'application/octet-stream';
    let body = fs.readFileSync(file);
    const headers = { 'Content-Type': type, 'Cache-Control': 'max-age=600' };
    if (/text|javascript|json|xml|svg|manifest/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers); res.end(body);
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
