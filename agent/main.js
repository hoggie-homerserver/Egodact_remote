'use strict';

/*
 * Egodact Remote - unified entrypoint
 *   egodact-remote.exe                         start local agent
 *   egodact-remote.exe --anywhere [mode]       local agent + tunnel (auto|cloudflare|tailscale)
 *   egodact-remote.exe --background            start hidden in background (keeps running)
 *   egodact-remote.exe --anywhere --background anywhere mode, hidden
 *   egodact-remote.exe --install-startup       auto-start at Windows login (hidden)
 *   egodact-remote.exe --uninstall-startup     remove auto-start
 *   egodact-remote.exe --show-link             print saved public/local link
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const server = require('./server');

const IS_PKG = typeof process.pkg !== 'undefined';
const RUNTIME_ROOT = server.ROOT;
const DATA_DIR = server.DATA_DIR;

function hasArg(name) {
    return process.argv.indexOf(name) !== -1;
}

function argValue(name, fallback) {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    const v = process.argv[i + 1];
    if (!v || v.charAt(0) === '-') return fallback;
    return v;
}

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) { /* ignore */ }
}

function appendLog(line) {
    try {
        ensureDataDir();
        fs.appendFileSync(path.join(DATA_DIR, 'agent.log'), '[' + new Date().toISOString() + '] ' + line + '\n', 'utf8');
    } catch (err) { /* ignore */ }
}

function readText(file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (err) { return ''; }
}

function startupFolder() {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function startupLinkPath() {
    return path.join(startupFolder(), 'Egodact Remote.lnk');
}

function hiddenLauncherPath() {
    return path.join(RUNTIME_ROOT, 'EgodactRemote-hidden.vbs');
}

function selfTarget() {
    if (IS_PKG) return process.execPath;
    return process.execPath; // node
}

function selfArgs(baseArgs) {
    const args = [];
    if (!IS_PKG) args.push(path.join(__dirname, 'main.js'));
    for (let i = 0; i < baseArgs.length; i++) args.push(baseArgs[i]);
    return args;
}

function quoteVbs(s) {
    return String(s).replace(/"/g, '""');
}

function writeHiddenLauncher(runArgs) {
    const target = selfTarget();
    const parts = [target].concat(selfArgs(runArgs));
    const cmd = parts.map(function (p) { return '"' + quoteVbs(p) + '"'; }).join(' ');
    const vbs = 'Set WshShell = CreateObject("WScript.Shell")\r\n' +
        'WshShell.CurrentDirectory = "' + quoteVbs(RUNTIME_ROOT) + '"\r\n' +
        'WshShell.Run ' + '"' + quoteVbs(cmd) + '"' + ', 0, False\r\n';
    fs.writeFileSync(hiddenLauncherPath(), vbs, 'utf8');
    return hiddenLauncherPath();
}

function runPs(script) {
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        encoding: 'utf8'
    });
}

function createShortcut(linkPath, targetPath, args, workdir) {
    const ps = "$ws = New-Object -ComObject WScript.Shell; " +
        "$s = $ws.CreateShortcut('" + String(linkPath).replace(/'/g, "''") + "'); " +
        "$s.TargetPath = '" + String(targetPath).replace(/'/g, "''") + "'; " +
        "$s.Arguments = '" + String(args || '').replace(/'/g, "''") + "'; " +
        "$s.WorkingDirectory = '" + String(workdir || '').replace(/'/g, "''") + "'; " +
        "$s.Description = 'Egodact Remote - herlaad extensies vanaf je telefoon'; " +
        "$s.WindowStyle = 7; " +
        "$s.Save()";
    return runPs(ps);
}

function installStartup() {
    ensureDataDir();
    try {
        if (!fs.existsSync(startupFolder())) fs.mkdirSync(startupFolder(), { recursive: true });
    } catch (err) {
        console.error('Kon opstartmap niet maken: ' + err.message);
        process.exit(1);
    }

    // Always start in anywhere mode at login so it's reachable; runs hidden so closing windows won't kill it.
    const runArgs = ['--anywhere', '--daemon-child'];
    let vbsPath;
    try {
        vbsPath = writeHiddenLauncher(runArgs);
    } catch (err) {
        console.error('Kon verborgen starter niet schrijven: ' + err.message);
        process.exit(1);
    }

    // Shortcut in Startup folder -> runs wscript with the VBS (hidden, no console window)
    const link = startupLinkPath();
    const res = createShortcut(link, 'wscript.exe', '//' + 'B "' + vbsPath + '"', RUNTIME_ROOT);
    if (res.status !== 0) {
        console.error('Autostart installeren mislukt.');
        if (res.stderr) console.error(String(res.stderr).trim());
        process.exit(1);
    }

    // Also register a scheduled task at logon as a reliable fallback
    const taskCmd = 'wscript.exe //B \\"' + vbsPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '\\"';
    spawnSync('schtasks', ['/Create', '/TN', 'Egodact Remote', '/TR', taskCmd, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'], {
        windowsHide: true,
        encoding: 'utf8'
    });

    console.log('Autostart ingeschakeld.');
    console.log('  Start bij Windows-login: overal bereikbaar (verborgen, zonder venster)');
    console.log('  Snelkoppeling: ' + link);
    console.log('  Verborgen starter: ' + vbsPath);
    console.log('');
    console.log('Je publieke/lokale link staat na opstarten in: ' + path.join(DATA_DIR, 'public-url.txt'));
    console.log('Token: ' + path.join(DATA_DIR, 'token.txt'));
    console.log('Log:   ' + path.join(DATA_DIR, 'agent.log'));
    console.log('');
    console.log('Let op: een Cloudflare-link verandert bij elke herstart.');
    console.log('Voor ALTIJD dezelfde link: installeer Tailscale op PC + telefoon en run eenmalig:');
    console.log('  tailscale serve --bg --https=443 http://127.0.0.1:8787');
}

function uninstallStartup() {
    const link = startupLinkPath();
    const vbs = hiddenLauncherPath();
    let removed = false;
    try {
        if (fs.existsSync(link)) { fs.unlinkSync(link); removed = true; console.log('Autostart-snelkoppeling verwijderd: ' + link); }
    } catch (err) { console.error('Verwijderen snelkoppeling mislukt: ' + err.message); }
    try {
        if (fs.existsSync(vbs)) { fs.unlinkSync(vbs); removed = true; console.log('Verborgen starter verwijderd: ' + vbs); }
    } catch (err) { /* ignore */ }
    spawnSync('schtasks', ['/Delete', '/TN', 'Egodact Remote', '/F'], { windowsHide: true });
    if (!removed) console.log('Geen autostart-installatie gevonden.');
    console.log('Autostart uitgeschakeld (draaiende agent stopt niet automatisch; sluit hem via Taakbeheer indien nodig).');
}

function showLink() {
    const token = readText(path.join(DATA_DIR, 'token.txt')) || server.TOKEN || '';
    const pub = readText(path.join(DATA_DIR, 'public-url.txt'));
    const nets = os.networkInterfaces();
    const locals = [];
    Object.keys(nets).forEach(function (name) {
        (nets[name] || []).forEach(function (n) {
            if (n.family === 'IPv4' && !n.internal) locals.push('http://' + n.address + ':' + server.PORT + '/?t=' + token);
        });
    });
    console.log('');
    console.log('  Egodact Remote - links');
    console.log('  -----------------------');
    if (pub) console.log('  Overal (laatst): ' + pub);
    else console.log('  Overal (laatst): (nog geen - start met --anywhere)');
    locals.forEach(function (u) { console.log('  Lokaal: ' + u); });
    console.log('  Token: ' + token);
    console.log('');
}

function maybeDaemonize() {
    if (hasArg('--daemon-child')) return false;
    if (!hasArg('--background')) return false;

    const childArgs = selfArgs(process.argv.slice(2).filter(function (a) { return a !== '--background'; }).concat(['--daemon-child']));
    const child = spawn(selfTarget(), childArgs, {
        cwd: RUNTIME_ROOT,
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
    });
    child.unref();

    console.log('Egodact Remote is op de achtergrond gestart.');
    console.log('  Link/token: ' + path.join(DATA_DIR, 'public-url.txt'));
    console.log('  Log:        ' + path.join(DATA_DIR, 'agent.log'));
    console.log('  Stoppen:    Taakbeheer -> proces "' + path.basename(selfTarget()) + '" / node beeindigen.');
    return true;
}

function setupDaemonLogging() {
    if (!hasArg('--daemon-child')) return;
    ensureDataDir();
    const logFile = path.join(DATA_DIR, 'agent.log');
    function write(kind, args) {
        try {
            const msg = Array.prototype.map.call(args, function (x) {
                try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { return String(x); }
            }).join(' ');
            fs.appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + kind + ' ' + msg + '\n', 'utf8');
        } catch (err) { /* ignore */ }
    }
    const origLog = console.log;
    const origErr = console.error;
    console.log = function () { write('INFO', arguments); };
    console.error = function () { write('ERR', arguments); };
    console.warn = function () { write('WARN', arguments); };
    process.on('uncaughtException', function (err) { write('ERR', [err && err.stack || err]); });
    process.on('unhandledRejection', function (err) { write('ERR', [err && err.stack || err]); });
    appendLog('daemon started');
}

function showHelp() {
    console.log('');
    console.log('  Egodact Remote v' + server.AGENT_VERSION);
    console.log('  ------------------------------------------------------------');
    console.log('  --anywhere [auto|cloudflare|tailscale]  overal bereikbaar starten');
    console.log('  --background                            verborgen op achtergrond starten');
    console.log('  --install-startup                       automatisch starten bij Windows-login');
    console.log('  --uninstall-startup                     autostart verwijderen');
    console.log('  --show-link                             huidige link/token tonen');
    console.log('  --help                                  deze hulp');
    console.log('');
    console.log('  Tip: voor ALTIJD dezelfde link gebruik Tailscale +');
    console.log('       tailscale serve --bg --https=443 http://127.0.0.1:8787');
    console.log('');
}

async function main() {
    if (hasArg('--help') || hasArg('-h')) { showHelp(); return; }
    if (hasArg('--install-startup')) { installStartup(); return; }
    if (hasArg('--uninstall-startup')) { uninstallStartup(); return; }
    if (hasArg('--show-link')) { showLink(); return; }

    if (maybeDaemonize()) return;
    setupDaemonLogging();

    if (hasArg('--anywhere')) {
        const mode = argValue('--anywhere', 'auto');
        const { startAnywhere } = require('./anywhere');
        await startAnywhere(mode === 'auto' ? '' : mode);
        return;
    }

    server.start();
}

main().catch(function (err) {
    try { appendLog('fatal: ' + (err && err.stack || err)); } catch (e) {}
    console.error(err && err.stack || err);
    process.exit(1);
});
