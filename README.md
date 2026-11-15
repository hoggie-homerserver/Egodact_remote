# Egodact Remote

Herlaad de Egodact-extensie en `app.egodact.com` op je PC vanaf je telefoon - thuis op wifi of overal via internet.

```
telefoon (PWA/app) --HTTPS--> tunnel --> agent op je PC --WebSocket--> companion --> chrome.management
```

**Let op:** stock Chrome op Android kan geen extensies draaien. Deze app bestuurt je PC vanaf je telefoon (reload extensies/tabbladen), hij vervangt de extensies op je telefoon niet.

## Installeren (GitHub Cloud - echte install)

Alles kan door GitHub Actions gebouwd worden, zodat je een echte APK op je telefoon kunt installeren en een `.exe` op je PC.

1. Push deze repo naar GitHub (bijv. `hoggie-homerserver/Egodact_remote`).
2. Ga naar **Actions** -> **Build Egodact Remote** -> **Run workflow** (of push een tag `v1.1.0`).
3. Download de bestanden bij de aangemaakte **Release**:
   - `EgodactRemote-Android.apk` -> op je telefoon installeren
   - `EgodactRemote-PC-win-x64.zip` -> op je PC uitpakken

> Android: sta "installeren vanuit onbekende bron" toe voor je browser/bestanden-app als Android dat vraagt.

## PC-installatie (exe)

1. Pak `EgodactRemote-PC-win-x64.zip` uit in een vaste map, bijv. `C:\EgodactRemote`.
2. Dubbelklik `start-remote-anywhere.cmd` (overal bereikbaar) of `EgodactRemote.exe` (alleen lokaal).
   - Bij de eerste keer: Windows Firewall -> sta **privenetwerken** toe.
   - In *anywhere*-modus downloadt de agent eenmalig `cloudflared.exe` (ca. 40 MB) naar `tools\` als je geen Tailscale hebt.
3. Laad de companion-extensie eenmalig:
   - `chrome://extensions` -> **Ontwikkelaarsmodus** aan -> **Load unpacked** -> map `companion`
   - Open de companion-instellingen, plak de **token** uit de agent-console, klik **Opslaan** -> **Test verbinding**.
4. Open de geprinte link op je telefoon (of plak hem in de Android-app) en gebruik **Herstart Egodact**.

### Automatisch starten met Windows

In de uitgepakte PC-map:

- `install-autostart.cmd` of `EgodactRemote.exe --install-startup`
  - maakt een snelkoppeling in je Opstartmap en start Egodact Remote automatisch bij inloggen (`--anywhere`).
- `uninstall-autostart.cmd` of `EgodactRemote.exe --uninstall-startup` om dit uit te zetten.

## Telefoon-app (APK)

1. Installeer `EgodactRemote-Android.apk` (van GitHub Releases).
2. Open de app en plak de link die de PC-agent print, bijvoorbeeld:
   `https://....trycloudflare.com/?t=<token>`
3. De app onthoudt de link. Met **Andere link instellen** kun je hem wijzigen (handig als je Cloudflare-link verandert).

Je kunt ook de PWA rechtstreeks in Chrome openen via dezelfde link en **Toevoegen aan startscherm** kiezen.

## Overal bereikbaar

`start-remote-anywhere.cmd` / `EgodactRemote.exe --anywhere` kiest automatisch:

- **Tailscale** (aanbevolen, vaste link): installeer Tailscale op PC + telefoon met hetzelfde account.
  Eenmalig op de PC: `tailscale serve --bg --https=443 http://127.0.0.1:8787`
  Dan krijg je een vaste `https://<pc>.<tailnet>.ts.net/?t=...` link.
- **Cloudflare quick tunnel** (geen account, direct): gratis HTTPS-tunnel; **de link verandert bij elke start**.
  De nieuwste link staat in `data/public-url.txt`.

## Vanuit broncode draaien (Node.js)

```powershell
node agent/main.js                  # lokaal
node agent/main.js --anywhere       # overal bereikbaar
```

## Wat je op je telefoon kunt doen

- **Herstart Egodact** - extensie opnieuw laden en `app.egodact.com` verversen
- Extensie / pagina los herladen, Egodact openen
- Alle extensies op de PC zien en per extensie herladen
- Actielog met resultaat; opdrachten wachten in de rij als de companion even offline is

## Beveiliging

- Alle API/WebSocket-aanroepen vereisen de token uit `data/token.txt`.
- Bij internetbereik blokkeert de agent een IP tijdelijk na 10 foute tokens.
- Deel je link/token niet; gebruik bij voorkeur Tailscale voor dagelijks gebruik.

## Bestanden

```
agent/main.js            unified entrypoint (server/anywhere/autostart)
agent/server.js          lokale server + WebSocket-relay
agent/anywhere.js        tunnel-modus (Tailscale of Cloudflare)
public/                  PWA
companion/               MV3 Chrome-extensie (management/tabs)
android-app/             Android WebView wrapper (APK)
.github/workflows/       GitHub Actions build (EXE + APK + Release)
data/token.txt           token (niet committen)
data/public-url.txt      laatst geprinte publieke link
tools/cloudflared.exe    eenmalig gedownload in anywhere-modus
```

## Problemen oplossen

- **PC offline in app** - companion aan? `http://127.0.0.1:8787/api/ping` bereikbaar op PC? agent/tunnel nog actief?
- **Token geweigerd** - token opnieuw uit agent-console kopieren (`data/token.txt`).
- **Poort bezet** - start met `set EGODACT_REMOTE_PORT=8788` en pas het adres in companion aan.
- **Cloudflare-link werkt niet meer** - tunnel herstart geeft nieuwe link; pak die uit console of `data/public-url.txt`.
- **Extensie niet gevonden** - gebruik de herlaadknop bij de extensie in de lijst (op id). "Herstart Egodact" zoekt op naam `Egodact`.
- **Build faalt in GitHub Actions** - controleer de workflow logs; Android build gebruikt Gradle/Java 17, PC build gebruikt Node + pkg.
