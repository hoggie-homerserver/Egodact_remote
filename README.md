# Egodact Remote

Herlaad de Egodact-extensie en het `app.egodact.com`-tabblad op je PC vanaf je telefoon -
op je eigen wifi of waar je ook bent.

```
telefoon (PWA)  --HTTPS-->  tunnel  -->  agent op je PC  --WebSocket-->  companion  -->  chrome.management
```

Geen account, geen cloudopslag, geen kosten.

## Wat je krijgt

- **Herstart Egodact** - extensie opnieuw inladen en daarna het Egodact-tabblad verversen.
- **Extensie / Pagina** - los herladen.
- **Open Egodact** - tabblad focussen of openen als het dicht is.
- **Alle extensies** - elke extensie die de companion ziet herladen.
- Een lijst met alle extensies op je PC (naam, versie, aan/uit) met een herlaadknop per regel.
- Laatste acties met resultaat, ook als je telefoon even weg was.

## Snel starten

| Situatie | Commando |
| --- | --- |
| Alleen thuis (zelfde wifi) | `start-remote.cmd` |
| Overal, snelste weg | `start-remote-anywhere.cmd` |
| Overal, vaste link | Tailscale installeren, dan `start-remote-anywhere.cmd` |

Beide printen een link met token. Open die op je telefoon.

### Eenmalige setup

1. **Agent** - `start-remote.cmd` of `start-remote-anywhere.cmd`. Sta Node.js toe op
   **privenetwerken** in de Windows Firewall-vraag.
2. **Companion** - `chrome://extensions` -> Ontwikkelaarsmodus aan -> **Load unpacked** ->
   map `Egodact_remote\companion`. Plak de token uit de agent-console, **Opslaan**,
   **Test verbinding**.
3. **Telefoon** - open de geprinte link in Chrome, menu -> **Toevoegen aan startscherm**.

De companion hoeft daarna alleen ingeschakeld te blijven; je hoeft het tabblad niet open te laten.

## Overal bereikbaar

`start-remote-anywhere.cmd` kiest automatisch:

### 1. Cloudflare quick tunnel (direct, geen account)

Werkt meteen: de agent downloadt eenmalig `cloudflared.exe` (ong. 40 MB) naar `tools\`
en opent een HTTPS-tunnel. Je krijgt een link als:

```
https://mooie-woorden-hier.trycloudflare.com/?t=<token>
```

- Voordeel: geen account, echt HTTPS, dus de PWA installeert netjes op je startscherm.
- Nadeel: **de link verandert bij elke herstart.** Handig om te testen, minder voor dagelijks.
- De tunnel is publiek bereikbaar; de token is de enige sleutel. Daarom blokkeert de agent
  een IP na 10 foute tokens (10 minuten).

### 2. Tailscale (vaste link, aanbevolen voor dagelijks gebruik)

1. Installeer Tailscale op je PC en telefoon en log op beide in met hetzelfde account.
2. Eenmalig HTTPS aanzetten op de PC:

   ```powershell
   tailscale serve --bg --https=443 http://127.0.0.1:8787
   ```

3. Start `start-remote-anywhere.cmd`. Je vaste link is dan:

   ```
   https://<pc-naam>.<tailnet>.ts.net/?t=<token>
   ```

Die link blijft gelijk, ook na herstarten, en werkt op 4G/5G en elk ander wifi-netwerk.
 zonder poorten open te zetten.

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
agent/server.js          lokale server + WebSocket-relay
agent/anywhere.js        tunnel-modus (Tailscale of Cloudflare)
public/                  PWA (index.html, app.js, styles.css, sw.js, manifest)
companion/               MV3-extensie met management/tabs-rechten
data/token.txt           automatisch aangemaakte token (niet committen)
data/public-url.txt      laatst geprinte publieke link
tools/cloudflared.exe    eenmalig gedownload door anywhere-modus
start-remote.cmd         starters
start-remote-anywhere.cmd
```

## Beperkingen

- Stock Chrome op Android kan **geen** extensies laden; deze app bestuurt je PC vanaf de telefoon.
- De agent is van jou: deel de link met token niet, en gebruik bij voorkeur Tailscale
  in plaats van de agent rechtstreeks op het internet te zetten.

## Problemen oplossen

- **"Token wordt geweigerd"** - token opnieuw uit de agent-console kopieren; hij verandert alleen
  als je `data/token.txt` verwijdert.
- **"Companion is offline"** - kijk of de companion-extensie aan staat en of
  `http://127.0.0.1:8787/api/ping` in de browser van de PC antwoordt.
- **"Te veel foute pogingen"** - de throttle blokkeert je IP 10 minuten na 10 foute tokens.
- **Poort bezet** - start met `EGODACT_REMOTE_PORT=8788` (en pas het adres in de companion aan).
- **Tunnel start niet** - controleer je internet en of `tools\cloudflared.exe` bestaat;
  verwijder hem anders en start opnieuw.
- **Extensie niet gevonden** - de knop zoekt op naam (`Egodact`). Gebruik anders de
  herlaadknop in de extensielijst, die op id werkt.
