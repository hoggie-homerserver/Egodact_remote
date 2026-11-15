'use strict';

/*
 * Egodact Remote - anywhere mode
 * ------------------------------------------------------------
 * Starts the local agent and exposes it outside your LAN:
 *
 *   tailscale  -> stable HTTPS name (recommended, needs Tailscale)
 *   cloudflare -> free quick tunnel, no account (URL changes per start)
 *
 *   node agent/anywhere.js            auto: tailscale if installed, else cloudflare
 *   node agent/anywhere.js tailscale
 *   node agent/anywhere.js cloudflare
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const DATA = path.join(ROOT, 'data');
const PORT = String(process.env.EGODACT_REMOTE_PORT || 8787);

const CF_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const CF_BIN = path.join(TOOLS, 'cloudflared.exe');
const URL_FILE = path.join(DATA, 'public-url.txt');

let agent = null;
let tunnel = null;
let cloudflaredBin = null;
let shuttingDown = false;

function log() {
    const stamp = new Date().toISOString().slice(11, 19);
    console.log.apply(console, ['[' + stamp + ']'].concat([].slice.call(arguments)));
}

function readToken() {
    try {
        return fs.readFileSync(path.join(DATA, 'token.txt'), 'utf8').trim();
    } catch (err) {
        return '';
    }
}

function copyToClipboard(text) {
    try {
        const child = spawn('cmd', ['/c', 'clip'], { windowsHide: true });
        child.stdin.end(text);
    } catch (err) {
        /* clipboard is a nicety, not a requirement */
    }
}

function printPublicLink(base, token) {
    const link = base.replace(/\/+$/, '') + '/?t=' + token;
    console.log('');
    console.log('  ==========================================');
    console.log('  OVERAL BEREIKBAAR');
    console.log('  ' + link);
    console.log('  ==========================================');
    console.log('  Link staat in je klembord.');
    console.log('  Open hem op je telefoon en zet hem op je startscherm.');
    console.log('');

    try {
        if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
        fs.writeFileSync(URL_FILE, link + '\n', 'utf8');
    } catch (err) {
        /* ignore */
    }
    copyToClipboard(link);
}

/* ------------------------------------------------------------------ *
 * wait for the agent
 * ------------------------------------------------------------------ */

function ping() {
    return new Promise(function (resolve) {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 1500 }, function (res) {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', function () { resolve(false); });
        req.on('timeout', function () { req.destroy(); resolve(false); });
    });
}

async function waitForAgent() {
    for (let i = 0; i < 60; i++) {
        if (await ping()) return true;
        await new Promise(function (r) { setTimeout(r, 300); });
    }
    return false;
}

/* ------------------------------------------------------------------ *
 * tailscale
 * ------------------------------------------------------------------ */

function findTailscale() {
    const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    const probe = spawnSync('tailscale', ['version'], { windowsHide: true });
    if (probe.status === 0) return 'tailscale';
    return null;
}

function tailscaleStatus(bin) {
    const res = spawnSync(bin, ['status', '--json'], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    if (res.status !== 0 || !res.stdout) return null;
    try {
        return JSON.parse(res.stdout);
    } catch (err) {
        return null;
    }
}

function tailscaleServeConfigured(bin) {
    const res = spawnSync(bin, ['serve', 'status'], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    if (res.status !== 0) return false;
    const out = String(res.stdout || '').trim();
    return out.length > 0 && out.indexOf('No serve config') === -1 && out.indexOf('not configured') === -1;
}

function runTailscale(bin, token) {
    const status = tailscaleStatus(bin);
    if (!status || !status.Self) {
        log('Tailscale is niet ingelogd. Open Tailscale en log in, of gebruik cloudflare.');
        return startCloudflare(token);
    }

    const dns = String(status.Self.DNSName || '').replace(/\.$/, '');
    const ips = Array.isArray(status.Self.TailscaleIPs) ? status.Self.TailscaleIPs : [];

    if (dns && tailscaleServeConfigured(bin)) {
        printPublicLink('https://' + dns, token);
        log('Tailscale HTTPS actief via ' + dns);
        return;
    }

    if (dns) {
        console.log('');
        console.log('  Tailscale gevonden. Zet eenmalig HTTPS aan:');
        console.log('    tailscale serve --bg --https=443 http://127.0.0.1:' + PORT);
        console.log('  Daarna is dit je vaste link:');
        console.log('    https://' + dns + '/?t=' + token);
    }

    if (ips.length) {
        printPublicLink('http://' + ips[0] + ':' + PORT, token);
        log('Tailscale-IP: ' + ips[0] + ' (werkt overal waar Tailscale aan staat)');
    } else {
        return startCloudflare(token);
    }
}

/* ------------------------------------------------------------------ *
 * cloudflare quick tunnel
 * ------------------------------------------------------------------ */

function download(url, dest, redirects) {
    const depth = redirects || 0;
    return new Promise(function (resolve, reject) {
        https.get(url, { headers: { 'User-Agent': 'egodact-remote' }, timeout: 60000 }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
                res.resume();
                resolve(download(new URL(res.headers.location, url).toString(), dest, depth + 1));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error('HTTP ' + res.statusCode));
                return;
            }

            const total = Number(res.headers['content-length'] || 0);
            let received = 0;
            let lastStep = -1;

            const out = fs.createWriteStream(dest);
            res.on('data', function (chunk) {
                received += chunk.length;
                const pct = total ? Math.floor((received / total) * 100) : 0;
                const step = Math.floor(pct / 10) * 10;
                if (total && step !== lastStep) {
                    lastStep = step;
                    process.stdout.write('  cloudflared downloaden... ' + step + '%\r');
                }
            });
            res.pipe(out);
            out.on('finish', function () {
                out.close(function () { resolve(); });
            });
            out.on('error', reject);
        }).on('error', reject).on('timeout', function () {
            reject(new Error('download time-out'));
        });
    });
}

async function ensureCloudflared() {
    if (fs.existsSync(CF_BIN)) return CF_BIN;

    if (!fs.existsSync(TOOLS)) fs.mkdirSync(TOOLS, { recursive: true });

    console.log('');
    log('cloudflared ontbreekt, eenmalig downloaden (ongeveer 40 MB)...');
    await download(CF_URL, CF_BIN);
    process.stdout.write('\n');
    log('cloudflared opgeslagen in ' + CF_BIN);
    return CF_BIN;
}

function startCloudflare(token) {
    ensureCloudflared().then(function (bin) {
        cloudflaredBin = bin;
        launchTunnel(token);
    }).catch(function (err) {
        log('cloudflared downloaden mislukt: ' + (err.message || err));
        log('Download handmatig ' + CF_URL + ' naar ' + CF_BIN);
    });
}

function launchTunnel(token) {
    const child = spawn(cloudflaredBin, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], {
        cwd: ROOT,
        windowsHide: true
    });

    tunnel = child;
    let buffer = '';
    let printed = false;

    function onData(chunk) {
        buffer += chunk.toString('utf8');
        if (!printed) {
            const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (match) {
                printed = true;
                printPublicLink(match[0], token);
                log('Cloudflare-tunnel actief. Deze link verandert als je opnieuw start.');
            }
        }
        if (buffer.length > 40000) buffer = buffer.slice(-20000);
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('exit', function (code) {
        if (shuttingDown) return;
        log('tunnel gestopt (' + code + '), nieuwe poging over 3 seconden');
        setTimeout(function () { launchTunnel(token); }, 3000);
    });

    child.on('error', function (err) {
        log('tunnel starten mislukt: ' + (err.message || err));
    });
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('');
    log('stoppen...');
    try { if (tunnel) tunnel.kill(); } catch (err) { /* ignore */ }
    try { if (agent) agent.kill(); } catch (err) { /* ignore */ }
    setTimeout(function () { process.exit(0); }, 400);
}

async function main() {
    const mode = String(process.argv[2] || '').toLowerCase();

    console.log('');
    console.log('  Egodact Remote - overal bereikbaar');
    console.log('  ----------------------------------');

    agent = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit', cwd: ROOT });
    agent.on('exit', function (code) {
        if (shuttingDown) return;
        log('agent gestopt (' + code + ')');
        shutdown();
    });

    const up = await waitForAgent();
    if (!up) {
        log('agent kwam niet op gang op poort ' + PORT);
        shutdown();
        return;
    }

    const token = readToken();
    if (!token) {
        log('geen token gevonden in data/token.txt');
        shutdown();
        return;
    }

    if (mode === 'cloudflare') {
        startCloudflare(token);
        return;
    }

    if (mode === 'tailscale') {
        const bin = findTailscale();
        if (!bin) {
            log('Tailscale is niet geinstalleerd (https://tailscale.com/download).');
            startCloudflare(token);
            return;
        }
        runTailscale(bin, token);
        return;
    }

    const bin = findTailscale();
    if (bin) {
        log('Tailscale gevonden, stabiele link wordt gebruikt.');
        runTailscale(bin, token);
    } else {
        log('Tailscale niet gevonden, Cloudflare quick tunnel wordt gebruikt.');
        startCloudflare(token);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(function (err) {
    console.error(err.stack || err.message);
    shutdown();
});
