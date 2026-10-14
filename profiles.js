/* MicReady MVP: profiles. Several people can practise on one device, each with their own
 * progress history. Everything is stored in this browser only.
 *
 *   verba_profiles   { list: [{ id, name }], active: id }
 *   history          the first profile keeps "verba_history"; others use "verba_history:<id>"
 *
 * Names with swear words, slurs or other offensive words are refused (namecheck.js).
 * Other scripts use window.VerbaProfiles and listen for the "verba:profile" event.
 */
(function () {
    'use strict';

    var KEY = 'verba_profiles';
    var FIRST = 'default';
    var MAX_PROFILES = 12;
    var state = load();
    var locked = false;     // a session is running: no switching by hand

    function load() {
        try {
            var s = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (s && Array.isArray(s.list) && s.list.length) {
                s.list = s.list.filter(function (p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; });
                if (s.list.length) {
                    if (!s.list.some(function (p) { return p.id === s.active; })) s.active = s.list[0].id;
                    return s;
                }
            }
        } catch (e) {}
        return { list: [{ id: FIRST, name: 'Me' }], active: FIRST };
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
    function find(id) { for (var i = 0; i < state.list.length; i++) if (state.list[i].id === id) return state.list[i]; return null; }
    function cleanName(name) { return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30); }
    // Swear words, slurs and other offensive words are not allowed in names (namecheck.js).
    function nameOk(name) { return !window.VerbaNameCheck || window.VerbaNameCheck.allowed(name); }
    function announce(reason) {
        document.dispatchEvent(new CustomEvent('verba:profile', { detail: { id: state.active, reason: reason || 'user' } }));
    }

    var api = {
        list: function () { return state.list.slice(); },
        count: function () { return state.list.length; },
        active: function () { return find(state.active); },
        activeId: function () { return state.active; },
        get: find,
        historyKey: function (id) { id = id || state.active; return id === FIRST ? 'verba_history' : 'verba_history:' + id; },
        isLocked: function () { return locked; },
        // reason "voice": switched because the voice was recognised (allowed during a session)
        setActive: function (id, reason) {
            if (!find(id) || id === state.active) return false;
            if (locked && reason !== 'voice') return false;
            state.active = id; save(); render(); announce(reason);
            return true;
        },
        add: function (name) {
            name = cleanName(name);
            if (!name || !nameOk(name) || state.list.length >= MAX_PROFILES) return null;
            var id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
            state.list.push({ id: id, name: name });
            state.active = id; save(); render(); announce('user');
            return id;
        },
        rename: function (id, name) {
            var p = find(id); name = cleanName(name);
            if (!p || !name || !nameOk(name)) return false;
            p.name = name; save(); render(); announce('rename');
            return true;
        },
        remove: function (id) {
            if (state.list.length < 2 || !find(id)) return false;
            try { localStorage.removeItem(api.historyKey(id)); } catch (e) {}
            document.dispatchEvent(new CustomEvent('verba:profile-removed', { detail: { id: id } }));
            state.list = state.list.filter(function (p) { return p.id !== id; });
            if (state.active === id) state.active = state.list[0].id;
            save(); render(); announce('remove');
            return true;
        }
    };
    window.VerbaProfiles = api;

    // ── UI ──
    function $(id) { return document.getElementById(id); }
    var select = $('profileSelect'), form = $('profileForm'), nameInput = $('profileName');
    var addBtn = $('profileAddBtn'), editBtn = $('profileEditBtn'), removeBtn = $('profileRemove');
    var status = $('profileStatus');
    var editing = null;     // null: adding a person; otherwise the id being renamed

    function render() {
        if (!select) return;
        select.innerHTML = '';
        state.list.forEach(function (p) {
            var o = document.createElement('option');
            o.value = p.id; o.textContent = p.name;
            if (p.id === state.active) o.selected = true;
            select.appendChild(o);
        });
        select.disabled = locked;
        if (addBtn) addBtn.disabled = locked || state.list.length >= MAX_PROFILES;
        if (editBtn) editBtn.disabled = locked;
        var bar = $('profileBar');
        if (bar) bar.classList.toggle('locked', locked);
        var saveLabel = $('saveProgressText');
        var name = api.active().name;
        if (saveLabel) saveLabel.textContent = state.list.length < 2 ? 'Save my progress on this device'
            : 'Save this session to ' + (name === 'Me' ? 'your' : name + '\u2019s') + ' progress';
    }
    function say(text) { if (status) status.textContent = text; }

    function openForm(id) {
        if (!form) return;
        editing = id;
        form.hidden = false;
        $('profileFormLabel').textContent = id ? 'New name for ' + find(id).name : 'Name of the person practicing';
        nameInput.value = id ? find(id).name : '';
        nameInput.removeAttribute('aria-invalid');
        if (removeBtn) removeBtn.hidden = !id || state.list.length < 2;
        if (editBtn) editBtn.setAttribute('aria-expanded', id ? 'true' : 'false');
        nameInput.focus();
    }
    function closeForm() {
        if (!form) return;
        form.hidden = true; editing = null;
        if (editBtn) editBtn.setAttribute('aria-expanded', 'false');
    }

    if (select) {
        select.addEventListener('change', function () {
            if (api.setActive(this.value, 'user')) say('Practicing as ' + api.active().name + '.');
        });
    }
    if (addBtn) addBtn.addEventListener('click', function () { openForm(null); });
    if (nameInput) nameInput.addEventListener('input', function () { nameInput.removeAttribute('aria-invalid'); });
    if (editBtn) editBtn.addEventListener('click', function () { if (form && !form.hidden && editing) closeForm(); else openForm(state.active); });
    if ($('profileCancel')) $('profileCancel').addEventListener('click', function () { var back = editing ? editBtn : addBtn; closeForm(); if (back) back.focus(); });
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var name = cleanName(nameInput.value);
            if (!name) { nameInput.focus(); return; }
            if (!nameOk(name)) {
                nameInput.setAttribute('aria-invalid', 'true');
                say('Please choose a different name. Names can\u2019t include swear words, slurs or other offensive words.');
                nameInput.focus(); nameInput.select();
                return;
            }
            nameInput.removeAttribute('aria-invalid');
            if (editing) { api.rename(editing, name); say('Renamed to ' + name + '.'); }
            else if (api.add(name)) say('Added ' + name + '. You are now practicing as ' + name + '.');
            closeForm();
            if (select) select.focus();
        });
    }
    if (removeBtn) {
        removeBtn.addEventListener('click', function () {
            var p = find(editing);
            if (!p) return;
            if (!window.confirm('Remove ' + p.name + '? Their saved sessions and voiceprint on this device are deleted too. This cannot be undone.')) return;
            api.remove(p.id);
            closeForm();
            say('Removed ' + p.name + '.');
            if (select) select.focus();
        });
    }

    document.addEventListener('verba:session-start', function () { locked = true; closeForm(); render(); });
    document.addEventListener('verba:session-reset', function () { locked = false; render(); });
    render();
}());
