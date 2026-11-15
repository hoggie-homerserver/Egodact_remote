'use strict';

(function () {
    const TOKEN_KEY = 'egodact_remote_token';
    const POLL_MS = 3000;

    const $ = function (id) { return document.getElementById(id); };

    const ICON = {
        reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v5h-5"/></svg>',
        ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
        fout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
        bezig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity=".3"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>'
    };

    const LABELS = {
        'reload-egodact': 'Egodact herstarten',
        'reload-extension': 'Extensie herladen',
        'reload-extensions': 'Extensies herladen',
        'reload-tab': 'Pagina herladen',
        'open-tab': 'Egodact openen',
        'ping': 'Ping'
    };

    /* ---------------- token ---------------- */

    const params = new URLSearchParams(location.search);
    const urlToken = params.get('t') || params.get('token');

    if (urlToken) {
        try { localStorage.setItem(TOKEN_KEY, urlToken); } catch (err) { /* private mode */ }
        params.delete('t');
        params.delete('token');
        const rest = params.toString();
        try {
            history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
        } catch (err) { /* ignore */ }
    }

    let token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (err) { token = ''; }

    /* ---------------- state ---------------- */

    let pollTimer = null;
    let lastResults = [];
    let pending = new Map();
    let toastTimer = null;

    function show(name) {
        $('pair').hidden = name !== 'pair';
        $('app').hidden = name !== 'app';
    }

    function toast(text, kind) {
        const el = $('toast');
        el.textContent = text;
        el.className = 'toast' + (kind ? ' ' + kind : '');
        el.hidden = false;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
    }

    function setOnline(online, note) {
        const pill = $('pcState');
        pill.className = 'pill ' + (online ? 'online' : 'offline');
        $('pcText').textContent = online ? 'PC online' : (note || 'PC offline');
    }

    /* ---------------- api ---------------- */

    function ApiError(message, status) {
        this.name = 'ApiError';
        this.message = message;
        this.status = status;
    }
    ApiError.prototype = Object.create(Error.prototype);

    async function api(path, options) {
        const opts = options || {};
        const res = await fetch(path, {
            method: opts.method || 'GET',
            headers: {
                'x-remote-token': token,
                'Content-Type': 'application/json'
            },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            cache: 'no-store'
        });

        if (res.status === 401) throw new ApiError('Token wordt geweigerd', 401);
        if (!res.ok) throw new ApiError('Agent antwoordde met ' + res.status, res.status);

        return res.json();
    }

    /* ---------------- handshake ---------------- */

    async function checkToken(value) {
        const res = await fetch('/api/state', {
            headers: { 'x-remote-token': value },
            cache: 'no-store'
        });
        if (res.status === 401) throw new ApiError('Deze token is niet geldig.', 401);
        if (!res.ok) throw new ApiError('Agent antwoordde met ' + res.status, res.status);
        return res.json();
    }

    async function pair(value) {
        const clean = String(value || '').trim();
        const error = $('pairError');
        error.hidden = true;

        if (!clean) {
            error.textContent = 'Vul de token uit de agent-console in.';
            error.hidden = false;
            return;
        }

        try {
            await checkToken(clean);
        } catch (err) {
            error.textContent = err.status === 401
                ? 'Deze token is niet geldig. Kijk in de agent-console.'
                : 'Geen verbinding met de agent. Draait hij op deze PC?';
            error.hidden = false;
            return;
        }

        token = clean;
        try { localStorage.setItem(TOKEN_KEY, token); } catch (err) { /* ignore */ }
        start();
    }

    /* ---------------- rendering ---------------- */

    function labelFor(type) {
        return LABELS[type] || type;
    }

    function renderExtensions(list) {
        const ul = $('extList');
        const empty = $('extEmpty');
        ul.textContent = '';

        if (!list || !list.length) {
            empty.hidden = false;
            empty.textContent = 'Nog geen gegevens van de companion.';
            return;
        }

        empty.hidden = true;

        list.forEach(function (ext) {
            const li = document.createElement('li');
            li.className = 'ext-row';

            const main = document.createElement('div');
            main.className = 'ext-main';

            const name = document.createElement('span');
            name.className = 'ext-name';
            name.textContent = ext.name + (ext.isSelf ? ' (deze companion)' : '');
            main.appendChild(name);

            const meta = document.createElement('div');
            meta.className = 'ext-meta';

            const version = document.createElement('span');
            version.className = 'badge';
            version.textContent = 'v' + (ext.version || '?');
            meta.appendChild(version);

            const state = document.createElement('span');
            state.className = 'badge ' + (ext.enabled ? 'aan' : 'uit');
            state.textContent = ext.enabled ? 'aan' : 'uit';
            meta.appendChild(state);

            main.appendChild(meta);
            li.appendChild(main);

            const btn = document.createElement('button');
            btn.className = 'icon-btn';
            btn.type = 'button';
            btn.innerHTML = ICON.reload;
            btn.title = 'Herladen';
            btn.setAttribute('aria-label', 'Herlaad ' + ext.name);
            btn.disabled = !!ext.isSelf;
            btn.addEventListener('click', function () {
                send('reload-extension', { id: ext.id });
            });
            li.appendChild(btn);

            ul.appendChild(li);
        });
    }

    function renderLog(results, pendingCount) {
        const ul = $('log');
        const empty = $('logEmpty');
        const items = [];

        pending.forEach(function (entry) {
            items.push({ kind: 'bezig', title: labelFor(entry.type), message: 'Bezig...', at: entry.at });
        });

        (results || []).forEach(function (entry) {
            items.push({
                kind: entry.ok ? 'ok' : 'fout',
                title: labelFor(entry.type),
                message: entry.message || (entry.ok ? 'Klaar' : 'Mislukt'),
                at: entry.at
            });
        });

        ul.textContent = '';

        if (!items.length) {
            empty.hidden = false;
            return;
        }

        empty.hidden = true;

        items.slice(0, 20).forEach(function (item) {
            const li = document.createElement('li');
            li.className = 'log ' + item.kind;

            const icon = document.createElement('span');
            icon.className = 'log-icon';
            icon.innerHTML = item.kind === 'ok' ? ICON.ok : (item.kind === 'fout' ? ICON.fout : ICON.bezig);
            li.appendChild(icon);

            const body = document.createElement('div');
            body.className = 'log-body';

            const title = document.createElement('span');
            title.className = 'log-title';
            title.textContent = item.title + timeSuffix(item.at);
            body.appendChild(title);

            if (item.message) {
                const msg = document.createElement('span');
                msg.className = 'log-msg';
                msg.textContent = item.message;
                body.appendChild(msg);
            }

            li.appendChild(body);
            ul.appendChild(li);
        });
    }

    function timeSuffix(at) {
        if (!at) return '';
        const date = new Date(at);
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return ' - ' + hh + ':' + mm;
    }

    /* ---------------- polling ---------------- */

    async function refresh() {
        if (!token) return;

        try {
            const data = await api('/api/state');
            setOnline(!!(data.companion && data.companion.online));

            const extensions = (data.companion && data.companion.extensions) || [];
            renderExtensions(extensions);

            lastResults = data.results || [];
            const seen = new Set(lastResults.map(function (r) { return r.id; }));
            const cutoff = Date.now() - 120000;
            pending.forEach(function (value, key) {
                if (seen.has(key) || value.at < cutoff) pending.delete(key);
            });

            renderLog(lastResults, data.pending || 0);

            const bits = ['agent v' + data.agent];
            if (data.companion && data.companion.browser) bits.push(data.companion.browser);
            if (data.companion && data.companion.online && extensions.length) bits.push(extensions.length + ' extensies');
            $('agentInfo').textContent = bits.join(' - ');
        } catch (err) {
            if (err.status === 401) {
                stop();
                localStorage.removeItem(TOKEN_KEY);
                token = '';
                $('pairError').textContent = 'De token is verlopen of gewijzigd. Plak de nieuwe token.';
                $('pairError').hidden = false;
                show('pair');
                return;
            }
            setOnline(false);
        }
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(function () {
            if (document.visibilityState === 'visible') refresh();
        }, POLL_MS);
    }

    function stop() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    /* ---------------- commands ---------------- */

    async function send(type, payload) {
        if (!token) return;

        try {
            const res = await api('/api/command', { method: 'POST', body: { type: type, payload: payload || {} } });
            pending.set(res.id, { type: type, at: Date.now() });
            renderLog(lastResults, pending.size);

            if (navigator.vibrate) navigator.vibrate(12);
            if (res.online) {
                toast(labelFor(type) + ' verstuurd', 'goed');
            } else {
                toast('Companion is offline - opdracht wacht in de rij', 'fout');
            }

            setTimeout(refresh, 600);
            setTimeout(refresh, 1800);
        } catch (err) {
            if (err.status === 401) {
                stop();
                token = '';
                try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
                show('pair');
                return;
            }
            toast('Versturen mislukt: ' + err.message, 'fout');
        }
    }

    /* ---------------- boot ---------------- */

    function start() {
        show('app');
        setOnline(false, 'Verbinden...');
        refresh();
        startPolling();
    }

    function bind() {
        $('pairSave').addEventListener('click', function () { pair($('pairToken').value); });
        $('pairToken').addEventListener('keydown', function (event) {
            if (event.key === 'Enter') pair($('pairToken').value);
        });

        $('restart').addEventListener('click', function () {
            send('reload-egodact', { match: 'Egodact', needle: 'app.egodact.com' });
        });

        Array.prototype.forEach.call(document.querySelectorAll('[data-command]'), function (button) {
            button.addEventListener('click', function () {
                let payload = {};
                try { payload = JSON.parse(button.getAttribute('data-payload') || '{}'); } catch (err) { payload = {}; }
                send(button.getAttribute('data-command'), payload);
            });
        });

        $('unpair').addEventListener('click', function () {
            stop();
            try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
            token = '';
            pending.clear();
            lastResults = [];
            $('pairToken').value = '';
            show('pair');
        });

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') refresh();
        });
    }

    bind();

    if (token) start();
    else show('pair');

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(function () { /* http op LAN heeft geen SW */ });
    }
})();
