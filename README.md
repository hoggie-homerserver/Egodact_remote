# Egodact Remote

Herlaad de Egodact-extensie en `app.egodact.com` op je PC vanaf je telefoon - thuis op wifi of overal via internet.

```
telefoon (PWA/app) --HTTPS--> tunnel --> agent op je PC --WebSocket--> companion --> chrome.management
```

**Let op:** stock Chrome op Android kan geen extensies draaien. Deze app bestuurt je PC vanaf je telefoon (reload extensies/tabbladen).

## Wat je krijgt

- **Herstart Egodact** - extensie opnieuw laden en daarna `app.egodact.com` verversen.
- Extensie / pagina los herladen, Egodact openen, alle extensies herladen.
- Lijst met extensies op je PC + per-extensie herlaadknop en actielog.
- Werkt thuis (wifi) of overal (tunnel). Geen account, geen cloudopslag.

## Installeren (GitHub Cloud - echte install)

1. Push deze repo naar GitHub.
2. **Actions** -> **Build Egodact Remote** -> **Run workflow** (of push tag `v1.1.0`).
3. Download uit **Releases**:
   - `EgodactRemote-Android.apk` -> echte app op je telefoon
   - `EgodactRemote-PC-win-x64.zip` -> `.exe` voor je PC

> Android: sta "installeren vanuit onbekende bron" toe als dat gevraagd wordt.

## PC (exe) - aanbevolen

1. Pak `EgodactRemote-PC-win-x64.zip` uit in een vaste map, bijv. `C:\EgodactRemote`.
2. Start eenmalig `EgodactRemote.exe --anywhere` (of `start-remote-anywhere.cmd`) om te testen.
   - Windows Firewall: sta **privenetwerken** toe.
   - Zonder Tailscale downloadt hij eenmalig `cloudflared.exe` naar `tools\`.
3. Companion-extensie eenmalig laden:
   - `chrome://extensions` -> **Ontwikkelaarsmodus** -> **Load unpacked** -> map `companion`
   - Plak de token uit de agent-console (of uit `data\token.txt`), **Opslaan** -> **Test verbinding**.
4. Open de geprinte link op je telefoon / in de Android-app.

### Altijd aan + automatisch starten (ook als je vensters sluit)

- **Autostart inschakelen:** `install-autostart.cmd` of `EgodactRemote.exe --install-startup`
  - Start Egodact Remote **verborgen op de achtergrond** bij elke Windows-login (`--anywhere`), via Startup + geplande taak. Sluit je terminal/vensters: hij blijft draaien.
- **Handmatig op achtergrond starten:** `EgodactRemote.exe --anywhere --background`
- **Link/token terugvinden (achtergrond):** `EgodactRemote.exe --show-link` of open `data\public-url.txt` en `data\token.txt`. Log: `data\agent.log`.
- **Stoppen:** Taakbeheer -> beeindig `EgodactRemote.exe` (of `node` bij broncode-modus).
- **Autostart uit:** `uninstall-autostart.cmd` of `EgodactRemote.exe --uninstall-startup`.

### Altijd dezelfde link

- **Cloudflare quick tunnel (standaard, geen account):** link is `https://....trycloudflare.com/?t=...` maar **verandert bij elke (her)start**. Nieuwe link staat in `data\public-url.txt` en in de log; plak hem opnieuw in de app ("Andere link instellen").
- **Tailscale (vaste, overal werkende link - aanbevolen):**
  1. Installeer Tailscale op je PC en telefoon, log op beide in met hetzelfde account.
  2. Eenmalig op de PC: `tailscale serve --bg --https=443 http://127.0.0.1:8787`
  3. Start Egodact Remote (of herstart). Je vaste link wordt: `https://<pc-naam>.<tailnet>.ts.net/?t=<token>` en blijft hetzelfde, ook na herstarten.

## Telefoon-app (APK)

1. Installeer `EgodactRemote-Android.apk` (GitHub Release).
2. Plak de link van je PC (`data\public-url.txt` / agent-console / `--show-link`).
3. De app onthoudt de link; met **Andere link instellen** wijzig je hem (nodig als je Cloudflare-link verandert).

Je kunt dezelfde link ook in Chrome openen -> **Toevoegen aan startscherm**.

## Vanuit broncode (Node.js)

```powershell
node agent/main.js --anywhere                  # zichtbaar, met link in console
node agent/main.js --anywhere --background     # verborgen op achtergrond
node agent/main.js --show-link                 # huidige link/token
node agent/main.js --install-startup           # autostart (verborgen)
```

## Opdrachten (exe)

| Opdracht | Wat het doet |
| --- | --- |
| `EgodactRemote.exe --anywhere` | agent + tunnel (zichtbaar) |
| `EgodactRemote.exe --anywhere --background` | agent + tunnel verborgen op achtergrond |
| `EgodactRemote.exe --install-startup` | automatisch starten bij login (verborgen, anywhere) |
| `EgodactRemote.exe --uninstall-startup` | autostart verwijderen |
| `EgodactRemote.exe --show-link` | opgeslagen/publieke link en token tonen |

## Beveiliging

- Token vereist voor alle API/WebSocket-aanroepen (`data/token.txt`).
- Bij internetbereik: tijdelijke blokkade na 10 foute tokens per IP.
- Deel je link/token niet. Voor dagelijks gebruik is Tailscale veiliger en stabieler dan een publieke tunnel.

## Bestanden

```
agent/main.js            entrypoint (server/anywhere/background/autostart)
agent/server.js          lokale server + WebSocket-relay
agent/anywhere.js        tunnel (Tailscale of Cloudflare)
public/                  PWA
companion/               Chrome-extensie (management/tabs)
android-app/             Android wrapper (APK)
.github/workflows/       GitHub Actions (EXE + APK + Release)
data/token.txt           token
data/public-url.txt      laatst bekende publieke link
data/agent.log           log (achtergrondmodus)
```

## Problemen oplossen

- **PC offline:** agent/tunnel draait? companion ingeschakeld en gekoppeld? `http://127.0.0.1:8787/api/ping` ok op PC?
- **Link werkt niet meer:** Cloudflare-link wijzigt bij herstart -> pak nieuwe uit `data/public-url.txt` of `--show-link`. Gebruik Tailscale voor een vaste link.
- **Venster sluiten stopt alles:** gebruik `--background` of `--install-startup` (verborgen) i.p.v. een gewoon consolevenster.
- **Poort bezet:** `set EGODACT_REMOTE_PORT=8788` en pas adres in companion aan.
- **Token geweigerd:** token uit `data/token.txt` opnieuw in companion/app zetten.
- **`start-remote-anywhere.cmd` sluit meteen:** open cmd in de map en run het daar om de fout te zien; controleer of Node in PATH is of gebruik de `.exe`.
- **Workflow niet zichtbaar op GitHub:** controleer dat `.github/workflows/build-release.yml` op de default branch staat en dat Actions + workflow write-permissies aan staan; push en ververs.
