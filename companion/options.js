'use strict';

const $ = function (id) { return document.getElementById(id); };
const DEFAULTS = { agentUrl: 'http://127.0.0.1:8787', token: '' };

function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = kind || '';
}

function normalizeUrl(value) {
    let url = String(value || '').trim();
    if (!url) return DEFAULTS.agentUrl;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url.replace(/\/+$/, '');
}

async function hasPermission(url) {
    try {
        const origin = new URL(url).origin + '/*';
        return await chrome.permissions.contains({ origins: [origin] });
    } catch (err) {
        return false;
    }
}

async function requestPermission(url) {
    try {
        const origin = new URL(url).origin + '/*';
        return await chrome.permissions.request({ origins: [origin] });
    } catch (err) {
        return false;
    }
}

async function load() {
    const stored = await chrome.storage.local.get(['agentUrl', 'token']);
    $('agentUrl').value = stored.agentUrl || DEFAULTS.agentUrl;
    $('token').value = stored.token || '';
}

async function test() {
    const base = normalizeUrl($('agentUrl').value);
    const token = $('token').value.trim();

    if (!token) {
        setStatus('Vul eerst de token in.', 'fout');
        return;
    }

    setStatus('Verbinden met ' + base + ' ...');

    try {
        const res = await fetch(base + '/api/state', {
            headers: { 'x-remote-token': token },
            cache: 'no-store'
        });
        if (res.status === 401) {
            setStatus('Token wordt geweigerd door de agent.', 'fout');
            return;
        }
        if (!res.ok) {
            setStatus('Agent antwoordde met HTTP ' + res.status + '.', 'fout');
            return;
        }

        const data = await res.json();
        const companion = data.companion || {};
        const count = (companion.extensions || []).length;

        if (companion.online) {
            setStatus(
                'Verbonden met agent v' + data.agent + '.\n' +
                'Extensies gezien: ' + count + '\n' +
                'Browser: ' + (companion.browser || 'onbekend'),
                'goed'
            );
        } else {
            setStatus(
                'Agent bereikbaar (v' + data.agent + '), maar de companion is nog niet verbonden.\n' +
                'Herlaad de extensie of wacht een paar seconden en test opnieuw.',
                ''
            );
        }
    } catch (err) {
        setStatus('Geen verbinding met ' + base + '.\n' + (err.message || err) +
            '\nDraait de agent? Controleer ook de firewall.', 'fout');
    }
}

$('save').addEventListener('click', async function () {
    const base = normalizeUrl($('agentUrl').value);
    const token = $('token').value.trim();

    if (!token) {
        setStatus('Vul eerst de token in.', 'fout');
        return;
    }

    if (!(await hasPermission(base))) {
        const granted = await requestPermission(base);
        if (!granted) {
            setStatus('Toegang tot ' + base + ' is niet gegeven; de companion kan de agent niet bereiken.', 'fout');
            return;
        }
    }

    await chrome.storage.local.set({ agentUrl: base, token: token });
    $('agentUrl').value = base;
    setStatus('Opgeslagen. Companion verbindt nu met ' + base + '.', 'goed');
    setTimeout(test, 1200);
});

$('test').addEventListener('click', test);

$('open').addEventListener('click', function () {
    const base = normalizeUrl($('agentUrl').value);
    const token = $('token').value.trim();
    const url = base + '/' + (token ? '?t=' + encodeURIComponent(token) : '');
    chrome.tabs.create({ url: url });
});

load().then(test).catch(function () {});
