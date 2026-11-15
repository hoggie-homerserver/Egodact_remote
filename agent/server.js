'use strict';

/*
 * Egodact Remote - local agent
 * ------------------------------------------------------------
 * Serves the phone PWA and relays commands to the companion
 * extension that runs inside Chrome on this PC.
 *
 *   phone  --HTTP-->  agent  --WebSocket-->  companion  --> chrome.management
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IS_PKG = typeof process.pkg !== 'undefined';
const RUNTIME_ROOT = IS_PKG ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const BUNDLE_ROOT = path.resolve(__dirname, '..');

function pickDir(preferred, fallback) {
    try {
        if (fs.existsSync(path.join(preferred, 'index.html'))) return preferred;
    } catch (err) { /* ignore */ }
    return fallback;
}

const PUBLIC_DIR = pickDir(path.join(RUNTIME_ROOT, 'public'), path.join(BUNDLE_ROOT, 'public'));
const DATA_DIR = path.join(RUNTIME_ROOT, 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'token.txt');

const PORT = Number(process.env.EGODACT_REMOTE_PORT || 8787);
const HOST = process.env.EGODACT_REMOTE_HOST || '0.0.0.0';
const AGENT_VERSION = '1.1.0';

/* ------------------------------------------------------------------ *
 * token
 * ------------------------------------------------------------------ */

function loadToken() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let token = '';
    if (fs.existsSync(TOKEN_FILE)) token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!/^[a-f0-9]{32,}$/i.test(token)) {
        token = crypto.randomBytes(24).toString('hex');
        fs.writeFileSync(TOKEN_FILE, token + '\n', 'utf8');
    }
    return token;
}

const TOKEN = loadToken();

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */

const state = {
    seq: 0,
    commands: [],
    results: [],
    companion: {
        lastSeen: 0,
        extensions: [],
        browser: '',
        companionVersion: '',
        agentUrl: ''
    }
};

const wsClients = new Set();

function log() {
    const stamp = new Date().toISOString().slice(11, 19);
    console.log.apply(console, ['[' + stamp + ']'].concat([].slice.call(arguments)));
}

function companionOnline() {
    return state.companion.lastSeen > 0 && Date.now() - state.companion.lastSeen < 45000;
}

function touchCompanion(patch) {
    state.companion.lastSeen = Date.now();
    if (patch && typeof patch === 'object') {
        for (const key of Object.keys(patch)) {
            if (patch[key] !== undefined) state.companion[key] = patch[key];
        }
    }
}

/* ------------------------------------------------------------------ *
 * minimal WebSocket (RFC 6455) - text frames only, no deps
 * ------------------------------------------------------------------ */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAccept(key) {
    return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function wsFrame(payload, opcode) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const len = data.length;
    const code = typeof opcode === 'number' ? opcode : 0x1;
    let header;

    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x80 | code;
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | code;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | code;
        header[1] = 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(len, 6);
    }
    return Buffer.concat([header, data]);
}

function wsSendRaw(client, payload, opcode) {
    try {
        client.socket.write(wsFrame(payload, opcode));
    } catch (err) {
        /* socket already gone */
    }
}

function wsSend(client, obj) {
    wsSendRaw(client, JSON.stringify(obj), 0x1);
}

function broadcast(obj) {
    for (const client of Array.from(wsClients)) wsSend(client, obj);
}

function dropClient(client) {
    if (!wsClients.has(client)) return;
    wsClients.delete(client);
    try { client.socket.destroy(); } catch (err) { /* ignore */ }
    if (wsClients.size === 0) {
        state.companion.lastSeen = Math.min(state.companion.lastSeen, Date.now() - 60000);
    }
    log('companion-socket gesloten');
}

function wsParse(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);

    for (;;) {
        const buf = client.buffer;
        if (buf.length < 2) return;

        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;

        if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
        } else if (len === 127) {
            if (buf.length < 10) return;
            const big = buf.readBigUInt64BE(2);
            len = Number(big);
            offset = 10;
        }

        let mask = null;
        if (masked) {
            if (buf.length < offset + 4) return;
            mask = buf.slice(offset, offset + 4);
            offset += 4;
        }

        if (buf.length < offset + len) return;

        const payload = Buffer.from(buf.slice(offset, offset + len));
        if (mask) {
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }

        client.buffer = buf.slice(offset + len);

        if (opcode === 0x8) {
            wsSendRaw(client, Buffer.alloc(0), 0x8);
            client.socket.end();
            return;
        }
        if (opcode === 0x9) {
            wsSendRaw(client, payload, 0xa);
            continue;
        }
        if (opcode === 0xa) continue;

        if (opcode === 0x1 || opcode === 0x0) {
            client.fragments = (client.fragments || '') + payload.toString('utf8');
            if (fin) {
                const text = client.fragments;
                client.fragments = '';
                handleWsMessage(client, text);
            }
        }
    }
}

function handleWsMessage(client, text) {
    let msg;
    try {
        msg = JSON.parse(text);
    } catch (err) {
        return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'hello') {
        touchCompanion({
            extensions: Array.isArray(msg.extensions) ? msg.extensions : state.companion.extensions,
            browser: typeof msg.browser === 'string' ? msg.browser : state.companion.browser,
            companionVersion: typeof msg.version === 'string' ? msg.version : state.companion.companionVersion,
            agentUrl: typeof msg.agentUrl === 'string' ? msg.agentUrl : state.companion.agentUrl
        });
        log('companion verbonden' + (msg.browser ? ' (' + msg.browser + ')' : ''));
        wsSend(client, { type: 'welcome', agentVersion: AGENT_VERSION, now: Date.now() });

        const now = Date.now();
        state.commands.forEach(function (c) {
            if (c.status !== 'pending' && c.status !== 'sent') return;
            if (now - c.createdAt > 120000) return;
            c.status = 'sent';
            c.sentAt = now;
            wsSend(client, {
                type: 'command',
                command: { id: c.id, seq: c.seq, type: c.type, payload: c.payload }
            });
        });
        return;
    }

    if (msg.type === 'heartbeat') {
        touchCompanion();
        wsSend(client, { type: 'heartbeat', t: Date.now() });
        return;
    }

    if (msg.type === 'report') {
        touchCompanion({
            extensions: Array.isArray(msg.extensions) ? msg.extensions : [],
            browser: typeof msg.browser === 'string' ? msg.browser : state.companion.browser,
            companionVersion: typeof msg.version === 'string' ? msg.version : state.companion.companionVersion,
            agentUrl: typeof msg.agentUrl === 'string' ? msg.agentUrl : state.companion.agentUrl
        });
        return;
    }

    if (msg.type === 'ack') {
        touchCompanion();
        finishCommand(msg.id, msg.ok !== false, msg.message || msg.error || '');
        return;
    }
}

/* ------------------------------------------------------------------ *
 * command queue
 * ------------------------------------------------------------------ */

function createCommand(type, payload, source) {
    const command = {
        id: crypto.randomBytes(6).toString('hex'),
        seq: ++state.seq,
        type: type,
        payload: payload || {},
        source: source || 'phone',
        createdAt: Date.now(),
        status: 'pending'
    };
    state.commands.push(command);
    broadcast({ type: 'command', command: command });
    log('opdracht', type, JSON.stringify(command.payload));
    prune();
    return command;
}

function finishCommand(id, ok, message) {
    const command = state.commands.find(function (c) { return c.id === id; });
    if (!command) return;
    command.status = ok ? 'done' : 'error';
    command.result = message || '';
    command.finishedAt = Date.now();

    state.results.push({
        id: command.id,
        type: command.type,
        payload: command.payload,
        ok: ok,
        message: command.result,
        at: command.finishedAt
    });
    if (state.results.length > 40) state.results = state.results.slice(-40);
    log('resultaat', command.type, ok ? 'ok' : 'fout', command.result);
}

function prune() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    state.commands = state.commands.filter(function (c) {
        return c.status === 'pending' || c.status === 'sent' || c.finishedAt > cutoff;
    });
    if (state.commands.length > 200) state.commands = state.commands.slice(-200);
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function readBody(req, limit) {
    return new Promise(function (resolve, reject) {
        let size = 0;
        const chunks = [];
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > (limit || 64 * 1024)) {
                reject(new Error('body te groot'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(new Error('ongeldige json'));
            }
        });
        req.on('error', reject);
    });
}

function requestToken(req, url) {
    const header = req.headers['x-remote-token'];
    if (typeof header === 'string' && header) return header;
    return url.searchParams.get('token') || url.searchParams.get('t') || '';
}

function authorized(req, url) {
    const given = requestToken(req, url);
    if (!given) return false;
    const a = Buffer.from(String(given));
    const b = Buffer.from(TOKEN);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

const authFailures = new Map();
const FAILURE_WINDOW = 5 * 60 * 1000;
const FAILURE_LIMIT = 10;
const LOCK_TIME = 10 * 60 * 1000;

function clientIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
    return req.socket.remoteAddress || 'onbekend';
}

function isLocked(ip) {
    const entry = authFailures.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.until) {
        authFailures.delete(ip);
        return false;
    }
    return true;
}

function noteFailure(ip) {
    const now = Date.now();
    let entry = authFailures.get(ip);
    if (!entry) {
        entry = { hits: [], until: 0 };
        authFailures.set(ip, entry);
    }
    entry.hits = entry.hits.filter(function (t) { return now - t < FAILURE_WINDOW; });
    entry.hits.push(now);
    if (entry.hits.length >= FAILURE_LIMIT) {
        entry.until = now + LOCK_TIME;
        entry.hits = [];
        log('te veel foute tokens van ' + ip + ', 10 minuten geblokkeerd');
    }
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2'
};

function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';

    const file = path.join(PUBLIC_DIR, rel);
    const normalized = path.normalize(file);
    if (!normalized.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('verboden');
        return;
    }

    fs.readFile(normalized, function (err, data) {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('niet gevonden');
            return;
        }
        const ext = path.extname(normalized).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
            'Content-Length': data.length
        });
        res.end(data);
    });
}

function lanUrls() {
    const urls = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
                urls.push('http://' + net.address + ':' + PORT);
            }
        }
    }
    return urls;
}

/* ------------------------------------------------------------------ *
 * http server
 * ------------------------------------------------------------------ */

const server = http.createServer(function (req, res) {
    let url;
    try {
        url = new URL(req.url, 'http://localhost');
    } catch (err) {
        res.writeHead(400);
        res.end('slecht verzoek');
        return;
    }

    const route = url.pathname;

    if (route === '/api/ping') {
        sendJson(res, 200, { ok: true, agent: AGENT_VERSION, now: Date.now() });
        return;
    }

    if (route.startsWith('/api/')) {
        const ip = clientIp(req);
        if (isLocked(ip)) {
            sendJson(res, 429, { ok: false, error: 'Te veel foute pogingen. Probeer het over een paar minuten opnieuw.' });
            return;
        }
        if (!authorized(req, url)) {
            noteFailure(ip);
            sendJson(res, 401, { ok: false, error: 'Ongeldige of ontbrekende token.' });
            return;
        }

        if (route === '/api/state' && req.method === 'GET') {
            sendJson(res, 200, {
                ok: true,
                agent: AGENT_VERSION,
                companion: {
                    online: companionOnline(),
                    lastSeen: state.companion.lastSeen,
                    extensions: state.companion.extensions,
                    browser: state.companion.browser,
                    version: state.companion.companionVersion,
                    agentUrl: state.companion.agentUrl
                },
                pending: state.commands.filter(function (c) { return c.status === 'pending' || c.status === 'sent'; }).length,
                results: state.results.slice(-15).reverse(),
                now: Date.now()
            });
            return;
        }

        if (route === '/api/command' && req.method === 'POST') {
            readBody(req).then(function (body) {
                const type = typeof body.type === 'string' ? body.type : '';
                if (!type) {
                    sendJson(res, 400, { ok: false, error: 'type ontbreekt' });
                    return;
                }
                const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
                const command = createCommand(type, payload, 'phone');
                sendJson(res, 200, { ok: true, id: command.id, seq: command.seq, online: companionOnline() });
            }).catch(function (err) {
                sendJson(res, 400, { ok: false, error: err.message });
            });
            return;
        }

        if (route === '/api/poll' && req.method === 'GET') {
            const after = Number(url.searchParams.get('after') || 0) || 0;
            touchCompanion();
            const now = Date.now();
            const pending = state.commands.filter(function (c) {
                if (c.seq <= after) return false;
                if (c.status !== 'pending' && c.status !== 'sent') return false;
                if (c.status === 'sent' && c.sentAt && now - c.sentAt < 15000) return false;
                return now - c.createdAt < 120000;
            });
            pending.forEach(function (c) {
                c.status = 'sent';
                c.sentAt = now;
            });
            sendJson(res, 200, {
                ok: true,
                cursor: state.seq,
                commands: pending.map(function (c) {
                    return { id: c.id, seq: c.seq, type: c.type, payload: c.payload };
                })
            });
            return;
        }

        if (route === '/api/ack' && req.method === 'POST') {
            readBody(req).then(function (body) {
                touchCompanion();
                finishCommand(body.id, body.ok !== false, body.message || body.error || '');
                sendJson(res, 200, { ok: true });
            }).catch(function (err) {
                sendJson(res, 400, { ok: false, error: err.message });
            });
            return;
        }

        if (route === '/api/report' && req.method === 'POST') {
            readBody(req).then(function (body) {
                touchCompanion({
                    extensions: Array.isArray(body.extensions) ? body.extensions : [],
                    browser: typeof body.browser === 'string' ? body.browser : state.companion.browser,
                    companionVersion: typeof body.version === 'string' ? body.version : state.companion.companionVersion,
                    agentUrl: typeof body.agentUrl === 'string' ? body.agentUrl : state.companion.agentUrl
                });
                sendJson(res, 200, { ok: true });
            }).catch(function (err) {
                sendJson(res, 400, { ok: false, error: err.message });
            });
            return;
        }

        sendJson(res, 404, { ok: false, error: 'onbekende route' });
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end('niet toegestaan');
        return;
    }

    serveStatic(req, res, url);
});

/* ------------------------------------------------------------------ *
 * websocket upgrade
 * ------------------------------------------------------------------ */

server.on('upgrade', function (req, socket) {
    let url;
    try {
        url = new URL(req.url, 'http://localhost');
    } catch (err) {
        socket.destroy();
        return;
    }

    if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    const upgradeIp = clientIp(req);
    if (isLocked(upgradeIp)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    if (!authorized(req, url)) {
        noteFailure(upgradeIp);
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
    );

    const client = { socket: socket, buffer: Buffer.alloc(0), fragments: '' };
    wsClients.add(client);
    socket.setNoDelay(true);

    touchCompanion();
    wsSend(client, { type: 'welcome', agentVersion: AGENT_VERSION, now: Date.now() });

    socket.on('data', function (chunk) {
        wsParse(client, chunk);
    });

    socket.on('end', function () {
        socket.destroy();
    });

    socket.on('close', function () {
        dropClient(client);
    });

    socket.on('error', function () {
        dropClient(client);
    });
});

/* ------------------------------------------------------------------ *
 * start
 * ------------------------------------------------------------------ */

let started = false;
let heartbeatTimer = null;

function start(options) {
    if (started) return server;
    started = true;
    const opts = options || {};

    heartbeatTimer = setInterval(function () {
        for (const client of Array.from(wsClients)) {
            if (client.socket.destroyed || client.socket.writableEnded) {
                dropClient(client);
                continue;
            }
            wsSend(client, { type: 'heartbeat', t: Date.now() });
        }
        prune();
        if (state.companion.lastSeen && Date.now() - state.companion.lastSeen > 90000) {
            state.companion.lastSeen = 0;
            state.companion.extensions = [];
        }
    }, 12000);
    if (heartbeatTimer.unref) heartbeatTimer.unref();

    server.listen(PORT, HOST, function () {
        const urls = lanUrls();
        console.log('');
        console.log('  Egodact Remote agent v' + AGENT_VERSION + ' draait');
        console.log('  ------------------------------------------');
        console.log('  Token: ' + TOKEN);
        console.log('');
        urls.forEach(function (base) {
            console.log('  Telefoon: ' + base + '/?t=' + TOKEN);
        });
        if (!urls.length) {
            console.log('  Telefoon: http://<ip-van-deze-pc>:' + PORT + '/?t=' + TOKEN);
        }
        console.log('');
        console.log('  De companion-extensie moet naar http://127.0.0.1:' + PORT + ' luisteren');
        console.log('  met dezelfde token. Stoppen met Ctrl+C.');
        console.log('');
        if (typeof opts.onListen === 'function') opts.onListen({ port: PORT, token: TOKEN, urls: urls });
    });

    server.on('error', function (err) {
        if (err.code === 'EADDRINUSE') {
            console.error('Poort ' + PORT + ' is al in gebruik. Stop het andere proces of zet EGODACT_REMOTE_PORT.');
        } else {
            console.error(err);
        }
        process.exit(1);
    });

    return server;
}

module.exports = {
    start: start,
    TOKEN: TOKEN,
    PORT: PORT,
    AGENT_VERSION: AGENT_VERSION,
    ROOT: RUNTIME_ROOT,
    BUNDLE_ROOT: BUNDLE_ROOT,
    DATA_DIR: DATA_DIR,
    IS_PKG: IS_PKG
};

if (require.main === module) start();
