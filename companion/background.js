'use strict';

/*
 * Egodact Remote Companion
 * ------------------------------------------------------------
 * Keeps a WebSocket open to the local Egodact Remote agent and
 * executes the commands the phone sends:
 *
 *   reload-extension  / reload-extensions  -> chrome.management
 *   reload-tab                              -> chrome.tabs
 *   open-tab                                -> chrome.tabs
 *   reload-egodact                          -> extension + tab
 *
 * All text in this file stays ASCII: the MV3 service worker has
 * choked on non-ASCII bytes before.
 */

const VERSION = '1.0.0';
const DEFAULTS = { agentUrl: 'http://127.0.0.1:8787', token: '' };
const WAKE_ALARM = 'egodact-remote-wake';

let socket = null;
let socketUrl = '';
let reconnectTimer = null;
let reconnectDelay = 1000;
let cursor = 0;
let connecting = false;
const recentCommands = new Set();

/* ------------------------------------------------------------------ *
 * config
 * ------------------------------------------------------------------ */

async function getConfig() {
    const stored = await chrome.storage.local.get(['agentUrl', 'token']);
    return {
        agentUrl: String(stored.agentUrl || DEFAULTS.agentUrl).replace(/\/+$/, ''),
        token: String(stored.token || DEFAULTS.token)
    };
}

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function wsOpen() {
    return !!socket && socket.readyState === WebSocket.OPEN;
}

function browserLabel() {
    const ua = (self.navigator && self.navigator.userAgent) || '';
    let m = ua.match(/Edg\/([\d.]+)/);
    if (m) return 'Edge ' + m[1].split('.')[0];
    m = ua.match(/OPR\/([\d.]+)/);
    if (m) return 'Opera ' + m[1].split('.')[0];
    m = ua.match(/Chrome\/([\d.]+)/);
    if (m) return 'Chrome ' + m[1].split('.')[0];
    return 'Chromium';
}

async function httpJson(pathname, method, body) {
    const cfg = await getConfig();
    const res = await fetch(cfg.agentUrl + pathname, {
        method: method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'x-remote-token': cfg.token
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
    });
    if (!res.ok) throw new Error('Agent antwoordde met ' + res.status);
    return res.json();
}

/* ------------------------------------------------------------------ *
 * websocket
 * ------------------------------------------------------------------ */

function scheduleReconnect(delay) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connect();
    }, typeof delay === 'number' ? delay : reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function closeSocket() {
    if (!socket) return;
    try { socket.close(); } catch (err) { /* ignore */ }
    socket = null;
    socketUrl = '';
}

async function connect() {
    if (connecting) return;
    if (wsOpen()) return;

    connecting = true;
    try {
        const cfg = await getConfig();
        if (!cfg.token) {
            connecting = false;
            return;
        }

        const url = cfg.agentUrl.replace(/^http/, 'ws') + '/ws?t=' + encodeURIComponent(cfg.token);
        if (socket && socketUrl === url) return;

        closeSocket();
        socketUrl = url;

        const ws = new WebSocket(url);
        socket = ws;

        ws.addEventListener('open', function () {
            reconnectDelay = 1000;
            connecting = false;
            report().catch(function () {});
        });

        ws.addEventListener('message', function (event) {
            let msg;
            try { msg = JSON.parse(event.data); } catch (err) { return; }
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'command' && msg.command) {
                handleCommand(msg.command);
                return;
            }
            if (msg.type === 'welcome') {
                report().catch(function () {});
            }
        });

        ws.addEventListener('close', function () {
            if (socket === ws) {
                socket = null;
                socketUrl = '';
            }
            connecting = false;
            scheduleReconnect();
        });

        ws.addEventListener('error', function () {
            if (socket === ws) {
                try { ws.close(); } catch (err) { /* ignore */ }
            }
            connecting = false;
        });
    } catch (err) {
        connecting = false;
        scheduleReconnect();
    }
}

/* ------------------------------------------------------------------ *
 * reporting
 * ------------------------------------------------------------------ */

async function listExtensions() {
    const all = await chrome.management.getAll();
    return all.filter(function (ext) { return ext.type === 'extension'; });
}

async function buildReport() {
    const cfg = await getConfig();
    const extensions = await listExtensions();
    return {
        version: VERSION,
        browser: browserLabel(),
        agentUrl: cfg.agentUrl,
        extensions: extensions.map(function (ext) {
            return {
                id: ext.id,
                name: ext.name,
                version: ext.version,
                enabled: ext.enabled,
                installType: ext.installType,
                isSelf: ext.id === chrome.runtime.id
            };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); })
    };
}

async function report() {
    const payload = await buildReport();
    payload.type = 'report';
    if (wsOpen()) {
        try { socket.send(JSON.stringify(payload)); } catch (err) { /* ignore */ }
        return;
    }
    await httpJson('/api/report', 'POST', payload).catch(function () {});
}

/* ------------------------------------------------------------------ *
 * command execution
 * ------------------------------------------------------------------ */

function pickTargets(all, payload) {
    const id = payload && typeof payload.id === 'string' ? payload.id : '';
    const match = payload && typeof payload.match === 'string' ? payload.match.toLowerCase() : '';

    let targets = all.filter(function (ext) { return ext.id !== chrome.runtime.id; });
    if (id) targets = targets.filter(function (ext) { return ext.id === id; });
    else if (match) targets = targets.filter(function (ext) { return ext.name.toLowerCase().indexOf(match) !== -1; });
    else targets = [];

    return targets;
}

async function reloadExtensions(payload) {
    const all = await listExtensions();
    const targets = pickTargets(all, payload);

    if (!targets.length) {
        throw new Error(payload && payload.match
            ? 'Geen extensie gevonden met "' + payload.match + '" in de naam'
            : 'Geen extensie gevonden');
    }

    const done = [];
    for (const ext of targets) {
        await chrome.management.setEnabled(ext.id, false);
        await sleep(400);
        await chrome.management.setEnabled(ext.id, true);
        done.push(ext.name + ' ' + ext.version);
        await sleep(250);
    }
    await sleep(500);
    return 'Herladen: ' + done.join(', ');
}

function matchesUrl(tab, needle) {
    if (!tab || !tab.url) return false;
    return tab.url.toLowerCase().indexOf(needle) !== -1;
}

async function reloadTabs(payload) {
    const needle = String((payload && (payload.urlPattern || payload.needle)) || 'app.egodact.com').toLowerCase();
    const tabs = await chrome.tabs.query({});
    const hits = tabs.filter(function (tab) { return matchesUrl(tab, needle); });

    if (!hits.length) throw new Error('Geen tabblad gevonden met ' + needle);

    for (const tab of hits) {
        await chrome.tabs.reload(tab.id, { bypassCache: !!(payload && payload.hard) });
    }
    return hits.length + ' tabblad(en) herladen';
}

async function openTab(payload) {
    const url = (payload && payload.url) || 'https://app.egodact.com/';
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(function (tab) { return tab.url && tab.url.indexOf(url) === 0; });

    if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined) {
            await chrome.windows.update(existing.windowId, { focused: true }).catch(function () {});
        }
        return 'Tabblad gefocust';
    }

    await chrome.tabs.create({ url: url });
    return 'Tabblad geopend';
}

async function reloadEgodact(payload) {
    const parts = [];

    try {
        parts.push(await reloadExtensions({ match: (payload && payload.match) || 'Egodact' }));
    } catch (err) {
        parts.push('extensie: ' + (err.message || err));
    }

    await sleep(1200);

    try {
        parts.push(await reloadTabs({ urlPattern: (payload && payload.needle) || 'app.egodact.com' }));
    } catch (err) {
        parts.push('tabblad: ' + (err.message || err));
    }

    return parts.join(' | ');
}

async function runCommand(cmd) {
    const payload = cmd.payload || {};

    switch (cmd.type) {
        case 'ping':
            return 'pong (' + VERSION + ')';
        case 'reload-extension':
        case 'reload-extensions':
            return reloadExtensions(payload);
        case 'reload-tab':
            return reloadTabs(payload);
        case 'open-tab':
            return openTab(payload);
        case 'reload-egodact':
            return reloadEgodact(payload);
        default:
            throw new Error('Onbekende opdracht: ' + cmd.type);
    }
}

async function sendAck(id, ok, message) {
    const payload = { type: 'ack', id: id, ok: ok, message: message };
    if (wsOpen()) {
        try { socket.send(JSON.stringify(payload)); return; } catch (err) { /* fall through */ }
    }
    await httpJson('/api/ack', 'POST', { id: id, ok: ok, message: message }).catch(function () {});
}

async function handleCommand(cmd) {
    if (!cmd || !cmd.id) return;
    if (recentCommands.has(cmd.id)) return;
    recentCommands.add(cmd.id);
    if (recentCommands.size > 100) {
        const first = recentCommands.values().next();
        if (!first.done) recentCommands.delete(first.value);
    }

    let ok = true;
    let message = '';
    try {
        message = await runCommand(cmd);
    } catch (err) {
        ok = false;
        message = (err && err.message) ? err.message : String(err);
    }

    await sendAck(cmd.id, ok, message);
    await report().catch(function () {});
}

/* ------------------------------------------------------------------ *
 * http polling fallback (when the socket cannot stay open)
 * ------------------------------------------------------------------ */

async function pollHttp() {
    const cfg = await getConfig();
    if (!cfg.token) return;

    const data = await httpJson('/api/poll?after=' + cursor, 'GET');
    cursor = typeof data.cursor === 'number' ? data.cursor : cursor;

    const commands = Array.isArray(data.commands) ? data.commands : [];
    for (const cmd of commands) await handleCommand(cmd);
}

/* ------------------------------------------------------------------ *
 * lifecycle
 * ------------------------------------------------------------------ */

async function boot() {
    const cfg = await getConfig();
    if (!cfg.token) return;
    await report().catch(function () {});
    await connect();
    await pollHttp().catch(function () {});
}

chrome.runtime.onInstalled.addListener(function (details) {
    chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
    if (details.reason === 'install') {
        chrome.storage.local.get(['agentUrl', 'token']).then(function (stored) {
            if (!stored.agentUrl) chrome.storage.local.set({ agentUrl: DEFAULTS.agentUrl });
            chrome.runtime.openOptionsPage();
        });
    }
    boot();
});

chrome.runtime.onStartup.addListener(function () {
    chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
    boot();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name !== WAKE_ALARM) return;
    boot();
});

chrome.action.onClicked.addListener(function () {
    chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.token || changes.agentUrl) {
        closeSocket();
        cursor = 0;
        reconnectDelay = 1000;
        boot();
    }
});

['onEnabled', 'onDisabled', 'onInstalled', 'onUninstalled'].forEach(function (name) {
    const event = chrome.management && chrome.management[name];
    if (!event || !event.addListener) return;
    event.addListener(function () {
        report().catch(function () {});
    });
});

/* keep the worker busy on first load as well */
boot().catch(function () {});
connect().catch(function () {});
