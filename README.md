# Egodact Remote

Herlaad de Egodact-extensie en het `app.egodact.com`-tabblad op je PC vanaf je telefoon.

```
telefoon (PWA)  --HTTP/WS-->  agent op je PC  --WebSocket-->  companion-extensie  -->  chrome.management
```

Geen cloud, geen account, geen kosten: alles blijft op je eigen netwerk.

## Wat je krijgt

- **Herstart Egodact** - extensie opnieuw inladen en daarna het Egodact-tabblad verversen.
- **Extensie / Pagina** - los herladen.
- **Open Egodact** - tabblad focussen of openen als het dicht is.
- **Alle extensies** - elke extensie die de companion ziet herladen, een voor een of in bulk.
- Een lijst met alle extensies op je PC (naam, versie, aan/uit) met een herlaadknop per regel.
- Laatste acties met resultaat, ook als je telefoon even weg was.

## Eenmalige setup (5 minuten)

### 1. Agent starten op je PC

Dubbelklik `start-remote.cmd`, of:

```powershell
node agent\server.js
```

De agent print een link met token, bijvoorbeeld:

```
Telefoon: http://192.168.178.37:8787/?t=21860b1e56cbf1703c56c2b612c2f0b322efadb87053c273
```

De eerste keer vraagt Windows Firewall om toestemming: sta **privenetwerken** toe.

### 2. Companion-extensie laden

1. Ga naar `chrome://extensions`.
2. Zet **Ontwikkelaarsmodus** aan.
3. **Load unpacked** -> kies de map `Egodact_remote\companion`.
4. De instellingenpagina opent. Plak de **token** uit de agent-console en klik **Opslaan**.
5. Bij **Test verbinding** hoort te staan: *Verbonden met agent*.

De companion hoeft daarna alleen ingeschakeld te blijven; je hoeft het tabblad niet open te laten.

### 3. Telefoon koppelen

Open de link met token uit stap 1 in Chrome op je telefoon (zelfde wifi).
Chrome-menu -> **Toevoegen aan startscherm** voor een app-icoon.

## Dagelijks gebruik

Agent draait -> icoon op je telefoon -> **Herstart Egodact**.

Werkt de knop niet, dan zegt de statuspil het al:

| Status | Betekenis |
| --- | --- |
| **PC online** | companion luistert; opdrachten komen direct aan |
| **PC offline** | agent onbereikbaar of companion uit; opdrachten wachten in de rij en lopen zodra de companion weer verbindt |

## Hoe het technisch werkt

- De agent luistert op poort `8787` en serveert de PWA plus een klein JSON-API.
  Alle `/api/*`-routes en de WebSocket eisen de token uit `data/token.txt`.
- De companion houdt een WebSocket open. De agent stuurt elke 12 s een heartbeat,
  waardoor de MV3-service-worker blijft leven en opdrachten binnen een seconde aankomen.
  Lukt de socket niet, dan valt de companion terug op HTTP-polling via een alarm elke 30 s.
- Herladen van een extensie gebeurt met `chrome.management.setEnabled(id, false)` gevolgd
  door `setEnabled(id, true)`: Chrome laadt de extensie dan opnieuw van schijf.
  Daarna ververst de companion het Egodact-tabblad, want content scripts injecteren
  alleen bij een navigatie.
- Alles is dependency-vrij: de WebSocket-server is met `net` en `crypto` geschreven.

## Bestanden

```
agent/server.js        lokale server + WebSocket-relay
public/                PWA (index.html, app.js, styles.css, sw.js, manifest)
companion/             MV3-extensie met management/tabs-rechten
data/token.txt         automatisch aangemaakte token (niet committen)
start-remote.cmd       dubbelklik-starter voor Windows
```

## Beperkingen

- Stock Chrome op Android kan **geen** extensies laden; deze app bestuurt je PC vanaf de telefoon.
- De PWA installeert als echte app op `https` of `localhost`. Over `http://192.168.x.x` maakt
  Chrome een snelkoppeling naar de pagina; dat werkt prima, alleen zonder service-worker-cache.
  Wil je echt installeren, zet dan bijvoorbeeld Tailscale Serve of een eigen HTTPS-proxy ervoor.
- De agent is bedoeld voor je eigen LAN. Zet hem niet rechtstreeks op het internet.

## Problemen oplossen

- **"Token wordt geweigerd"** - token opnieuw uit de agent-console kopieren; hij verandert alleen
  als je `data/token.txt` verwijdert.
- **"Companion is offline"** - kijk of de companion-extensie aan staat en of
  `http://127.0.0.1:8787/api/ping` in de browser van de PC antwoordt.
- **Poort bezet** - start met `EGODACT_REMOTE_PORT=8788` (en pas het adres in de companion aan).
- **Extensie niet gevonden** - de knop zoekt op naam (`Egodact`). Hernoem je extensie of gebruik
  de herlaadknop in de extensielijst, die op id werkt.
