'use strict';

/*
 * Egodact Remote - unified entrypoint
 *   egodact-remote.exe                start local agent
 *   egodact-remote.exe --anywhere     start local agent + tunnel (auto)
 *   egodact-remote.exe --anywhere cloudflare
 *   egodact-remote.exe --anywhere tailscale
 *   egodact-remote.exe --install-startup
 *   egodact-remote.exe --uninstall-startup
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const server = require('./server');

function arg(name) {
    return process.argv.indexOf(name) !== -1;
}

function argValue(name, fallback) {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    const v = process.argv[i + 1];
    if (!v || v.charAt(0) === '-') return fallback;
    return v;
}

function startupFolder() {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function startupLink() {
    return path.join(startupFolder(), 'Egodact Remote.lnk');
}

function exePath() {
    return process.pkg ? process.execPath : process.execPath;
}

function exeArgs() {
    // autostart: run anywhere mode headless-ish by default? keep console visible is fine.
    return '--anywhere';
}

function runPs(script) {
    const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        encoding: 'utf8'
    });
    return res;
}

function installStartup() {
    const link = startupLink();
    const target = exePath();
    const workdir = path.dirname(target);
    const args = exeArgs();

    try {
        if (!fs.existsSync(startupFolder())) fs.mkdirSync(startupFolder(), { recursive: true });
    } catch (err) {
        console.error('Kon opstartmap niet maken: ' + err.message);
        process.exit(1);
    }

    const ps = "$ws = New-Object -ComObject WScript.Shell; " +
        "$s = $ws.CreateShortcut('" + link.replace(/'/g, "''") + "'); " +
        "$s.TargetPath = '" + target.replace(/'/g, "''") + "'; " +
        "$s.Arguments = '" + args.replace(/'/g, "''") + "'; " +
        "$s.WorkingDirectory = '" + workdir.replace(/'/g, "''") + "'; " +
        "$s.Description = 'Egodact Remote - herlaad extensies vanaf je telefoon'; " +
        "$s.Save()";

    const res = runPs(ps);
    if (res.status !== 0) {
        console.error('Autostart installeren mislukt.');
        if (res.stderr) console.error(res.stderr.trim());
        process.exit(1);
    }

    console.log('Autostart ingeschakeld.');
    console.log('  Snelkoppeling: ' + link);
    console.log('  Start: ' + target + ' ' + args);
    console.log('');
    console.log('Egodact Remote start nu automatisch wanneer je Windows opstart.');
}

function uninstallStartup() {
    const link = startupLink();
    try {
        if (fs.existsSync(link)) {
            fs.unlinkSync(link);
            console.log('Autostart uitgeschakeld: ' + link);
        } else {
            console.log('Geen autostart-snelkoppeling gevonden.');
        }
    } catch (err) {
        console.error('Verwijderen mislukt: ' + err.message);
        process.exit(1);
    }
}

function showHelp() {
    console.log('');
    console.log('  Egodact Remote v' + server.AGENT_VERSION);
    console.log('  ------------------------------------------');
    console.log('  --anywhere [auto|cloudflare|tailscale]  overal bereikbaar starten');
    console.log('  --install-startup                       automatisch starten bij Windows-login');
    console.log('  --uninstall-startup                     autostart verwijderen');
    console.log('  --help                                  deze hulp');
    console.log('');
}

async function main() {
    if (arg('--help') || arg('-h')) {
        showHelp();
        return;
    }

    if (arg('--install-startup')) {
        installStartup();
        return;
    }

    if (arg('--uninstall-startup')) {
        uninstallStartup();
        return;
    }

    if (arg('--anywhere')) {
        const mode = argValue('--anywhere', 'auto');
        const { startAnywhere } = require('./anywhere');
        await startAnywhere(mode === 'auto' ? '' : mode);
        return;
    }

    // default: local agent
    server.start();
}

main().catch(function (err) {
    console.error(err.stack || err.message);
    process.exit(1);
});
