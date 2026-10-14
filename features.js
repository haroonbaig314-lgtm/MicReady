/* MicReady MVP: progress history (per profile), results image, and "add to home screen".
 *
 * Everything here runs in the browser. Session history is stored only in this
 * browser's localStorage, and only after the visitor turns progress tracking on.
 * Stored records hold numbers (duration, pace, counts, score), never words.
 */
(function () {
    'use strict';

    var OPT = 'verba_history_opt';
    // Each profile has its own history. The first profile keeps the original key.
    function historyKey() {
        return window.VerbaProfiles ? window.VerbaProfiles.historyKey() : 'verba_history';
    }
    var MAX_SESSIONS = 500;
    var CHART_SESSIONS = 30;

    function $(id) { return document.getElementById(id); }

    // ── Storage ──
    function readHistory(key) {
        try {
            var v = JSON.parse(localStorage.getItem(key || historyKey()) || '[]');
            return Array.isArray(v) ? v.filter(function (r) { return r && typeof r.t === 'number'; }) : [];
        } catch (e) { return []; }
    }
    function writeHistory(list, key) {
        try { localStorage.setItem(key || historyKey(), JSON.stringify(list.slice(-MAX_SESSIONS))); return true; } catch (e) { return false; }
    }
    function optedIn() {
        try { return localStorage.getItem(OPT) === '1'; } catch (e) { return false; }
    }
    function setOptIn(on) {
        try { localStorage.setItem(OPT, on ? '1' : '0'); } catch (e) {}
    }

    var last = null;       // latest finished session (numbers only)
    var lastSaved = false;
    var lastGroup = null;  // group practice: one record per person, saved to that person's history

    function toRecord(r) {
        return { t: r.t, dur: r.dur, words: r.words, wpm: r.wpm, fil: r.fil, fpm: r.fpm, score: r.score,
                 pau: r.pau, lpau: r.lpau, hed: r.hed, lang: r.lang, mode: r.mode };
    }
    function saveLast() {
        if (!last || lastSaved) return;
        var P = window.VerbaProfiles;
        if (lastGroup && P) {
            // Group practice: each person's own part goes to their own progress.
            lastGroup.forEach(function (g) {
                if (!P.get(g.id) || g.rec.dur < 5) return;
                var key = P.historyKey(g.id), list = readHistory(key);
                list.push(toRecord(g.rec));
                writeHistory(list, key);
            });
            lastSaved = true;
            render();
            return;
        }
        if (last.dur < 10 || last.words < 5) return;
        var list = readHistory();
        list.push(toRecord(last));
        if (writeHistory(list)) lastSaved = true;
        render();
    }

    document.addEventListener('verba:session-end', function (e) {
        last = e.detail;
        lastSaved = false;
        var g = window.VerbaVoice && window.VerbaVoice.lastGroup && window.VerbaVoice.lastGroup();
        lastGroup = g && g.records && g.records.length ? g.records : null;
        var label = $('saveProgressText');
        if (label && lastGroup) label.textContent = 'Save each person\u2019s results to their own progress';
        var cb = $('saveProgress');
        if (cb) cb.checked = optedIn();
        if (optedIn()) saveLast();
    });

    var saveBox = $('saveProgress');
    if (saveBox) {
        saveBox.addEventListener('change', function () {
            setOptIn(this.checked);
            if (this.checked) saveLast();
            render();
        });
    }
    if ($('progressEnable')) $('progressEnable').addEventListener('click', function () { setOptIn(true); render(); });
    if ($('progressStop')) $('progressStop').addEventListener('click', function () { setOptIn(!optedIn()); render(); });
    if ($('progressClear')) {
        $('progressClear').addEventListener('click', function () {
            var who = window.VerbaProfiles && window.VerbaProfiles.count() > 1 ? ' for ' + window.VerbaProfiles.active().name : '';
            if (!window.confirm('Delete every saved session' + who + ' from this device? This cannot be undone.')) return;
            try { localStorage.removeItem(historyKey()); } catch (e) {}
            render();
        });
    }

    // ── Helpers ──
    function dayKey(t) {
        var d = new Date(t);
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function streak(list) {
        var days = {};
        list.forEach(function (r) { days[dayKey(r.t)] = true; });
        var d = new Date();
        if (!days[dayKey(d.getTime())]) {
            d.setDate(d.getDate() - 1);
            if (!days[dayKey(d.getTime())]) return 0;
        }
        var n = 0;
        while (days[dayKey(d.getTime())]) { n++; d.setDate(d.getDate() - 1); }
        return n;
    }
    function fmtDate(t, withYear) {
        var opts = { month: 'short', day: 'numeric' };
        if (withYear) opts.year = 'numeric';
        try { return new Date(t).toLocaleDateString(undefined, opts); } catch (e) { return new Date(t).toDateString(); }
    }
    function fmtDur(s) { var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
    var MODE_NAMES = { free: 'Free practice', pitch: '60-second pitch', interview: 'Interview answer',
                       presentation: 'Class presentation', impromptu: 'Impromptu talk' };

    var METRICS = {
        fpm:   { label: 'Fillers per minute', title: 'Fillers per minute in each session (lower is better)',
                 fmt: function (v) { return (Math.round(v * 10) / 10).toFixed(1); }, unit: ' per min' },
        wpm:   { label: 'Pace', title: 'Pace in words per minute (about 130 to 160 is comfortable for listeners)',
                 fmt: function (v) { return String(Math.round(v)); }, unit: ' WPM' },
        score: { label: 'Score', title: 'Session score out of 100 (higher is better)',
                 fmt: function (v) { return String(Math.round(v)); }, unit: '' }
    };
    var metric = 'fpm';

    function el(tag, attrs, text) {
        var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (var k in attrs) n.setAttribute(k, attrs[k]);
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function niceStep(range, ticks) {
        var raw = range / ticks, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), r = raw / mag;
        return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    }

    // ── Chart: one series, line + light area wash, crosshair tooltip ──
    var chartState = null;
    function renderChart(list) {
        var area = $('chartArea'), tip = $('chartTip');
        if (!area) return;
        var m = METRICS[metric];
        var data = list.slice(-CHART_SESSIONS).filter(function (r) { return metric !== 'wpm' || r.wpm > 0; });
        $('chartTitle').textContent = m.title + (data.length > 1 ? ', last ' + data.length + ' sessions' : '');
        area.innerHTML = '';
        tip.hidden = true;
        if (!data.length) {
            var p = document.createElement('p');
            p.className = 'chart-single';
            p.textContent = 'No sessions with this measurement yet.';
            area.appendChild(p);
            chartState = null;
            return;
        }
        var W = Math.max(280, area.clientWidth || 600), H = 220;
        var M = { l: 40, r: 56, t: 14, b: 28 };
        var vals = data.map(function (r) { return r[metric] || 0; });
        var lo, hi;
        if (metric === 'score') { lo = 0; hi = 100; }
        else if (metric === 'fpm') { lo = 0; hi = Math.max(2, Math.max.apply(null, vals) * 1.15); }
        else { lo = Math.max(0, Math.min(110, Math.min.apply(null, vals) - 15)); hi = Math.max(180, Math.max.apply(null, vals) + 15); }
        var step = niceStep(hi - lo, 4);
        lo = Math.floor(lo / step) * step;
        hi = Math.ceil(hi / step) * step;
        var x = function (i) { return data.length === 1 ? M.l + (W - M.l - M.r) / 2 : M.l + i * (W - M.l - M.r) / (data.length - 1); };
        var y = function (v) { return M.t + (H - M.t - M.b) * (1 - (v - lo) / (hi - lo)); };

        var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
                              'aria-label': m.title + '. Latest: ' + m.fmt(vals[vals.length - 1]) + m.unit + '.' });
        for (var v = lo; v <= hi + 1e-9; v += step) {
            svg.appendChild(el('line', { 'class': 'grid', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }));
            svg.appendChild(el('text', { 'class': 'axis-text', x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, metric === 'fpm' ? String(Math.round(v * 10) / 10) : String(Math.round(v))));
        }
        if (metric === 'wpm' && lo <= 130 && hi >= 160) {
            svg.appendChild(el('rect', { x: M.l, y: y(160), width: W - M.l - M.r, height: y(130) - y(160), fill: 'var(--vf-grid)', opacity: 0.55 }));
            svg.appendChild(el('text', { 'class': 'axis-text', x: M.l + 6, y: y(160) + 13 }, 'comfortable range'));
        }
        // x labels: first and last session dates
        svg.appendChild(el('text', { 'class': 'axis-text', x: x(0), y: H - 8, 'text-anchor': data.length === 1 ? 'middle' : 'start' }, fmtDate(data[0].t)));
        if (data.length > 1) svg.appendChild(el('text', { 'class': 'axis-text', x: x(data.length - 1), y: H - 8, 'text-anchor': 'end' }, fmtDate(data[data.length - 1].t)));

        if (data.length > 1) {
            var d = '', a = '';
            vals.forEach(function (val, i) { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1); });
            a = d + 'L' + x(vals.length - 1).toFixed(1) + ' ' + y(lo).toFixed(1) + 'L' + x(0).toFixed(1) + ' ' + y(lo).toFixed(1) + 'Z';
            svg.appendChild(el('path', { 'class': 'series-area', d: a }));
            svg.appendChild(el('path', { 'class': 'series-line', d: d }));
        }
        var lastI = vals.length - 1;
        svg.appendChild(el('circle', { 'class': 'series-dot', cx: x(lastI), cy: y(vals[lastI]), r: 5 }));
        svg.appendChild(el('text', { 'class': 'end-label', x: x(lastI) + 9, y: y(vals[lastI]) + 4 }, m.fmt(vals[lastI])));
        var cross = el('line', { 'class': 'crosshair', x1: 0, x2: 0, y1: M.t, y2: H - M.b, visibility: 'hidden' });
        var hoverDot = el('circle', { 'class': 'series-dot', cx: 0, cy: 0, r: 5, visibility: 'hidden' });
        svg.appendChild(cross);
        svg.appendChild(hoverDot);
        svg.appendChild(el('rect', { 'class': 'hit', x: M.l - 10, y: 0, width: W - M.l - M.r + 20, height: H }));
        area.appendChild(svg);

        if (data.length === 1) {
            var note = document.createElement('p');
            note.className = 'chart-single';
            note.textContent = 'Practice again to start a trend line.';
            area.appendChild(note);
        }
        chartState = { data: data, vals: vals, x: x, y: y, svg: svg, cross: cross, dot: hoverDot, W: W, idx: -1 };
    }

    function showPoint(i) {
        var s = chartState, tip = $('chartTip'), area = $('chartArea');
        if (!s || i < 0 || i >= s.data.length) return;
        s.idx = i;
        var px = s.x(i), py = s.y(s.vals[i]);
        s.cross.setAttribute('x1', px); s.cross.setAttribute('x2', px); s.cross.setAttribute('visibility', 'visible');
        s.dot.setAttribute('cx', px); s.dot.setAttribute('cy', py); s.dot.setAttribute('visibility', 'visible');
        var r = s.data[i], m = METRICS[metric];
        tip.innerHTML = '';
        var strong = document.createElement('strong');
        strong.textContent = m.fmt(s.vals[i]) + m.unit;
        var meta = document.createElement('span');
        meta.textContent = fmtDate(r.t, true) + ' · ' + (MODE_NAMES[r.mode] || 'Practice') + ' · ' + fmtDur(r.dur);
        tip.appendChild(strong);
        tip.appendChild(meta);
        tip.hidden = false;
        var scale = area.clientWidth / s.W;
        var left = px * scale + 12;
        if (left + tip.offsetWidth > area.clientWidth) left = px * scale - tip.offsetWidth - 12;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = Math.max(0, py * scale - 20 + $('chartTitle').offsetHeight) + 'px';
    }
    function hidePoint() {
        var s = chartState;
        $('chartTip').hidden = true;
        if (!s) return;
        s.cross.setAttribute('visibility', 'hidden');
        s.dot.setAttribute('visibility', 'hidden');
    }
    var chartArea = $('chartArea');
    if (chartArea) {
        chartArea.addEventListener('pointermove', function (e) {
            var s = chartState;
            if (!s) return;
            var rect = s.svg.getBoundingClientRect();
            var px = (e.clientX - rect.left) * (s.W / rect.width);
            var best = 0, bd = Infinity;
            s.data.forEach(function (_, i) { var dd = Math.abs(s.x(i) - px); if (dd < bd) { bd = dd; best = i; } });
            showPoint(best);
        });
        chartArea.addEventListener('pointerleave', hidePoint);
        chartArea.addEventListener('blur', hidePoint);
        chartArea.addEventListener('focus', function () { if (chartState) showPoint(chartState.data.length - 1); });
        chartArea.addEventListener('keydown', function (e) {
            var s = chartState;
            if (!s) return;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                var i = s.idx < 0 ? s.data.length - 1 : s.idx + (e.key === 'ArrowRight' ? 1 : -1);
                showPoint(Math.max(0, Math.min(s.data.length - 1, i)));
            } else if (e.key === 'Escape') {
                hidePoint();
            }
        });
    }

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.chart-tab'));
    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { selectTab(tab); });
        tab.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            next.focus();
            selectTab(next);
        });
    });
    function selectTab(tab) {
        metric = tab.getAttribute('data-metric');
        tabs.forEach(function (t) {
            var on = t === tab;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        $('chartWrap').setAttribute('aria-labelledby', tab.id);
        renderChart(readHistory());
    }
    tabs.forEach(function (t, i) { t.tabIndex = i === 0 ? 0 : -1; });

    // ── Panel ──
    function kpi(label, value, note) {
        var d = document.createElement('div');
        d.className = 'kpi';
        var l = document.createElement('div'); l.className = 'kpi-label'; l.textContent = label;
        var v = document.createElement('div'); v.className = 'kpi-value'; v.textContent = value;
        d.appendChild(l); d.appendChild(v);
        if (note) { var n = document.createElement('div'); n.className = 'kpi-note'; n.textContent = note; d.appendChild(n); }
        return d;
    }

    function renderTable(list) {
        var table = $('historyTable');
        if (!table) return;
        table.innerHTML = '';
        var head = document.createElement('tr');
        ['Date', 'Mode', 'Length', 'Fillers / min', 'WPM', 'Pauses', 'Score'].forEach(function (h) {
            var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th);
        });
        var thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
        var tbody = document.createElement('tbody');
        list.slice().reverse().forEach(function (r) {
            var tr = document.createElement('tr');
            [fmtDate(r.t, true), MODE_NAMES[r.mode] || 'Practice', fmtDur(r.dur), (r.fpm || 0).toFixed(1),
             r.wpm ? String(r.wpm) : '--', String(r.pau || 0), String(r.score)].forEach(function (c) {
                var td = document.createElement('td'); td.textContent = c; tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
    }

    function render() {
        var list = readHistory(), on = optedIn();
        var empty = $('progressEmpty'), body = $('progressBody');
        if (!empty || !body) return;
        var P = window.VerbaProfiles;
        var who = P && P.count() > 1 && P.active().name !== 'Me' ? P.active().name : null;
        if ($('progressTitle')) $('progressTitle').textContent = who ? who + '\u2019s progress' : 'Your progress';
        if (!list.length) {
            empty.hidden = false;
            body.hidden = true;
            $('progressEmptyText').textContent = on
                ? 'Progress tracking is on. Finish a session of at least 10 seconds and it will appear here.'
                : 'Progress tracking is off. Turn it on to keep a history of your sessions on this device and see how your filler rate, pace and score change over time.';
            $('progressEnable').hidden = on;
            return;
        }
        empty.hidden = true;
        body.hidden = false;
        var row = $('kpiRow');
        row.innerHTML = '';
        var recent = list.slice(-5);
        var avgFpm = recent.reduce(function (s, r) { return s + (r.fpm || 0); }, 0) / recent.length;
        var best = list.reduce(function (b, r) { return Math.max(b, r.score); }, 0);
        var st = streak(list);
        row.appendChild(kpi('Sessions', String(list.length)));
        row.appendChild(kpi('Day streak', String(st), st === 1 ? 'day' : 'days in a row'));
        row.appendChild(kpi('Best score', String(best)));
        row.appendChild(kpi('Fillers per minute', avgFpm.toFixed(1), 'average of last ' + recent.length));
        renderChart(list);
        renderTable(list);
        $('progressStop').textContent = on ? 'Stop saving sessions' : 'Resume saving sessions';
    }

    document.addEventListener('verba:profile', function () { render(); });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { if (!$('progressBody').hidden) renderChart(readHistory()); }, 150);
    });
    render();

    // ── Results image ──
    function siteLabel() {
        var c = document.querySelector('link[rel="canonical"]');
        var href = c ? c.href : location.href;
        return href.replace(/^https?:\/\//, '').replace(/index\.html$/, '').replace(/\/$/, '');
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function drawCard(r, W, H) {
        var c = document.createElement('canvas');
        c.width = W; c.height = H;
        var ctx = c.getContext('2d');
        var tall = H > W;
        var g = tall ? ctx.createLinearGradient(0, 0, 0, H) : ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#16301f');
        g.addColorStop(1, '#2d5a44');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        var F = 'Inter, -apple-system, "Segoe UI", sans-serif';

        var stats = [
            ['Fillers per minute', (r.fpm || 0).toFixed(1)],
            ['Pace', r.wpm ? r.wpm + ' WPM' : '--'],
            ['Length', fmtDur(r.dur)],
            ['Pauses', String(r.pau || 0)]
        ];
        var date = fmtDate(r.t, true);
        var sub = r.mode && r.mode !== 'free' ? (MODE_NAMES[r.mode] + ' · ' + date) : ('Practice session · ' + date);

        function ring(cx, cy, rad, lw) {
            ctx.lineWidth = lw;
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#86efac';
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, r.score / 100)); ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = '800 ' + Math.round(rad * 0.78) + 'px ' + F;
            ctx.fillText(String(r.score), cx, cy + rad * 0.22);
            ctx.font = '600 ' + Math.round(rad * 0.19) + 'px ' + F;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillText(r.grade || '', cx, cy + rad * 0.55);
        }
        function statBox(x, y, w, h, label, value) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            roundRect(ctx, x, y, w, h, Math.round(h * 0.16));
            ctx.fill();
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.78)';
            var size = Math.round(h * 0.17), room = w - h * 0.44;
            ctx.font = '600 ' + size + 'px ' + F;
            while (size > 10 && ctx.measureText(label).width > room) { size--; ctx.font = '600 ' + size + 'px ' + F; }
            ctx.fillText(label, x + h * 0.22, y + h * 0.36);
            ctx.fillStyle = '#ffffff';
            var vsize = Math.round(h * 0.34);
            ctx.font = '800 ' + vsize + 'px ' + F;
            while (vsize > 12 && ctx.measureText(value).width > room) { vsize--; ctx.font = '800 ' + vsize + 'px ' + F; }
            ctx.fillText(value, x + h * 0.22, y + h * 0.8);
        }

        ctx.textBaseline = 'alphabetic';
        if (tall) {
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = '800 76px ' + F;
            ctx.fillText('MicReady', W / 2, 230);
            ctx.font = '500 38px ' + F;
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.fillText(sub, W / 2, 310);
            ring(W / 2, 760, 250, 30);
            var bw = 440, bh = 210, gx = 40, top = 1170;
            stats.forEach(function (s, i) {
                statBox(W / 2 - bw - gx / 2 + (i % 2) * (bw + gx), top + Math.floor(i / 2) * (bh + gx), bw, bh, s[0], s[1]);
            });
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.font = '500 34px ' + F;
            ctx.fillText('Practice for free at', W / 2, 1780);
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 38px ' + F;
            ctx.fillText(siteLabel(), W / 2, 1834);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.font = '800 44px ' + F;
            ctx.fillText('MicReady', 60, 92);
            ctx.font = '500 24px ' + F;
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.fillText(sub, 60, 134);
            ring(300, 370, 160, 22);
            var w2 = 255, h2 = 150, g2 = 24, left = 600, top2 = 150;
            stats.forEach(function (s, i) {
                statBox(left + (i % 2) * (w2 + g2), top2 + Math.floor(i / 2) * (h2 + g2), w2, h2, s[0], s[1]);
            });
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.font = '500 22px ' + F;
            ctx.fillText('Practice for free at', left, 540);
            var url = siteLabel(), usize = 24, room2 = W - left - 40;
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 ' + usize + 'px ' + F;
            while (usize > 14 && ctx.measureText(url).width > room2) { usize--; ctx.font = '700 ' + usize + 'px ' + F; }
            ctx.fillText(url, left, 574);
        }
        return c;
    }

    function cardBlob(kind) {
        var size = kind === 'wide' ? [1200, 627] : [1080, 1920];
        var fonts = document.fonts && document.fonts.load
            ? Promise.all([document.fonts.load('800 80px Inter'), document.fonts.load('600 40px Inter'), document.fonts.load('500 40px Inter')]).catch(function () {})
            : Promise.resolve();
        var timeout = new Promise(function (res) { setTimeout(res, 1500); });
        return Promise.race([fonts, timeout]).then(function () {
            var canvas = drawCard(last, size[0], size[1]);
            return new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
        });
    }
    function fileName(kind) {
        var d = new Date(last.t);
        var ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return 'micready-session-' + ymd + (kind === 'wide' ? '-linkedin' : '-story') + '.png';
    }
    function download(kind) {
        if (!last) return;
        cardBlob(kind).then(function (blob) {
            if (!blob) return;
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fileName(kind);
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        });
    }
    if ($('shareStory')) $('shareStory').addEventListener('click', function () { download('story'); });
    if ($('shareWide')) $('shareWide').addEventListener('click', function () { download('wide'); });

    var canShareFiles = false;
    try {
        canShareFiles = !!(navigator.canShare && window.File &&
            navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' })] }));
    } catch (e) { canShareFiles = false; }
    if (canShareFiles && $('shareNative')) {
        $('shareNative').hidden = false;
        $('shareNative').addEventListener('click', function () {
            if (!last) return;
            cardBlob('story').then(function (blob) {
                if (!blob) return;
                var file = new File([blob], fileName('story'), { type: 'image/png' });
                navigator.share({ files: [file], title: 'My MicReady practice session', text: 'I scored ' + last.score + ' in a MicReady practice session.' }).catch(function () {});
            });
        });
    }

    // Exposed for automated tests.
    window.VerbaFeatures = { drawCard: drawCard, readHistory: readHistory, streak: streak };

    // ── Add to home screen (installable web app) ──
    var deferredPrompt = null;
    var installBtn = $('installBtn');
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.hidden = false;
    });
    if (installBtn) {
        installBtn.addEventListener('click', function () {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function () {}, function () {}).then(function () {
                deferredPrompt = null;
                installBtn.hidden = true;
            });
        });
    }
    window.addEventListener('appinstalled', function () { if (installBtn) installBtn.hidden = true; });
}());
