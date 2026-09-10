## eduarte-homeassistant

Haalt het rooster, het huiswerk en de aanwezigheidsregistratie uit het Eduarte
studentenportaal en biedt die aan Home Assistant aan als een iCalendar-feed en
een JSON-status. Bedoeld voor ouders en studenten die hun rooster in Home
Assistant willen hebben in plaats van steeds op het portaal in te loggen.

Afgeleid van [reneax/eduarte-bot](https://github.com/reneax/eduarte-bot), waarin
dezelfde scraper een Discord-bot voedde. Die scraper (`src/api/`) is de kern van
dit project; de Discord-laag is vervangen door een HTTP-service. Met dank aan
reneax voor het uitzoekwerk aan het portaal.

> **Werkt dit bij jouw school?** Dat weet je pas als je het probeert. Eduarte
> draait bij elke school als een eigen instantie, en die verschillen in HTML.
> Deze code is tegen één instantie ontwikkeld en getest. Er zit gereedschap in om
> dat te controleren en aan te passen — zie [Werkt het bij jouw
> school?](#werkt-het-bij-jouw-school) hieronder. Pull requests die meer varianten
> ondersteunen zijn welkom.

### Wat je in Home Assistant krijgt

| Wat | Hoe |
|---|---|
| Rooster als kalender-entiteit | `Remote Calendar`-integratie op `/calendar.ics` |
| Huidige les, volgende les, lessen vandaag/morgen | REST-sensoren op `/state.json` |
| Aanwezig / absent / niet geregistreerd per les | REST-sensoren + `binary_sensor.eduarte_absent_gemeld` |
| Huiswerk | In de omschrijving van elke les, en als lijst in `sensor.eduarte_huiswerk` |
| Stage (BPV) apart van lessen | `binary_sensor.eduarte_op_stage`; BPV telt niet mee als les |

De service schrijft niets terug naar Eduarte; hij leest alleen.

### Hoe het werkt

Eduarte heeft geen API. De service logt met een echte browser (Puppeteer) in —
ook via Microsoft SSO met 2FA — en gebruikt de sessiecookie daarna voor gewone
HTTP-requests, waarvan de HTML wordt uitgelezen.

Elke ophaalronde levert alleen het venster op dat het portaal op dat moment
toont. Opgehaalde dagen worden daarom in `data/agenda.json` bewaard en per datum
samengevoegd, zodat de kalender lessen uit het verleden (en de absentie die
daarbij hoort) blijft tonen.

### Installeren als Home Assistant App

Op Home Assistant OS draai je dit als lokale App (voorheen: add-on).

1. Kopieer deze map naar `/addons/eduarte-bridge/` op je HA-machine, bijvoorbeeld
   via de Samba- of Advanced SSH-app. De map moet `config.yaml` en `Dockerfile`
   in de wortel hebben.
2. Ga naar **Instellingen → Apps → App-winkel**, klik rechtsboven op
   **Controleer op updates** en herlaad de pagina. *Eduarte bridge* verschijnt
   onder *Local add-ons*.
3. Installeren. De eerste build duurt een paar minuten (Chromium wordt
   meegeïnstalleerd).
4. Vul op het tabblad **Configuratie** in:

   | Optie | Toelichting |
   |---|---|
   | `portal_url` | De URL van het portaal, bijvoorbeeld `https://<school>.eduarte.nl` |
   | `eduarte_email` | Het e-mailadres van het schoolaccount |
   | `eduarte_password` | Het wachtwoord |
   | `totp_secret` | Het TOTP-secret uit de QR-code van de 2FA-instelling; leeg als er geen 2FA is |
   | `is_microsoft_login` | `true` bij Microsoft SSO, `false` bij een eigen Eduarte-login |
   | `api_token` | Zelfgekozen geheim; verplicht als de poort buiten je netwerk bereikbaar is |
   | `calendar_name` | Naam die in de kalender-feed staat |
   | `placement_names` | Agenda-items met deze namen tellen als stage in plaats van les (standaard `BPV`, komma-gescheiden) |
   | `refresh_interval` | Minuten tussen ophaalacties (standaard 30) |
   | `history_days` | Hoeveel dagen verleden bewaard blijft (standaard 90); bepaalt ook hoe ver `absent_lessons` terugkijkt |

5. Starten en het logboek bekijken. Bij een geslaagde start staat er
   `Agenda refreshed: N day(s), M lesson(s).`

Het TOTP-secret haal je uit de QR-code die Microsoft toont bij het instellen van
de authenticator: scan hem met een QR-lezer en neem de waarde achter `secret=`
over. Als het account al 2FA heeft, moet je dat opnieuw instellen om het secret
te zien.

### Koppelen aan Home Assistant

**Kalender** — Instellingen → Apparaten & diensten → Integratie toevoegen →
*Remote Calendar*. Als URL:

```
http://<ip-van-je-ha>:8099/calendar.ics?token=<api_token>
```

**Sensoren** — kopieer `homeassistant/eduarte.yaml` naar
`/config/packages/eduarte.yaml`, vul `secrets.yaml` aan zoals in dat bestand
beschreven, en herlaad met Ontwikkelhulpmiddelen → Acties → `rest.reload`.
Zorg dat `configuration.yaml` de packages inleest:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

### Endpoints

| Pad | Inhoud |
|---|---|
| `GET /calendar.ics` | Het rooster als iCalendar; huiswerk en aanwezigheid staan in de omschrijving |
| `GET /state.json` | Huidige/volgende les, lessen vandaag en morgen, absentietellers, huiswerklijst |
| `POST /refresh` | Forceert direct een ophaalronde |
| `GET /health` | Status voor de watchdog; vereist geen token |

Met `api_token` ingesteld moet elk verzoek (behalve `/health`) een
`Authorization: Bearer <token>`-header of `?token=<token>` meesturen.

### Buiten Home Assistant draaien

```
npm ci
cp .env.dist .env      # invullen
npm run build && npm start
```

### Werkt het bij jouw school?

Begin hiermee voordat je aan Home Assistant denkt:

```
npm ci
cp .env.dist .env      # portal_url, e-mail en wachtwoord invullen
npm run probe
```

De probe logt in, schrijft de ruwe agendapagina naar `data/agenda-page.html` en
laat zien wat de parser eruit haalt. Krijg je een nette lijst met vakken, tijden
en lokalen, dan werkt het. Zo niet, dan vertelt de opgeslagen HTML wat er anders
is; de selectors staan bij elkaar in `src/api/eduarte-api.ts`.

Twee verschillen die al bekend zijn en allebei ondersteund worden:

- Sommige instanties zetten `lokaal - vak - klas - docent` in één element
  (`.agenda-class`), andere geven elk veld een eigen element (`.agenda-class`,
  `.agenda-teacher`, `.agenda-location`).
- Inloggen kan via Microsoft SSO of via een eigen Eduarte-account
  (`is_microsoft_login`).

### Ontwikkelen

```
npm test               # unit tests van de parser, de datumlogica, ICS en status
npm run probe          # logt in, slaat de agendapagina op en toont wat de parser ziet
npm run probe -- data/agenda-page.html    # opnieuw parsen zonder in te loggen
```

`npm run probe` is het gereedschap voor als het portaal verandert: het schrijft
de ruwe HTML naar `data/agenda-page.html` zodat de selectors in
`src/api/eduarte-api.ts` daarop aangepast kunnen worden.

De tests draaien zonder netwerk of inloggegevens: ze voeren de parser uit op
opgeslagen HTML-fragmenten. Voeg je ondersteuning voor een andere instantie toe,
neem dan een fragment van die pagina op als test.

### Bekende beperkingen

- Het portaal toont per keer één week. De bridge loopt daarom bij elke ophaalronde
  `weeks_ahead` weken vooruit (standaard 4) door het datumfilter te bedienen, en
  voegt de resultaten samen. Zet je dat op 1, dan zie je alleen de huidige week.
  Het verleden blijft bewaard, dus de kalender groeit vanzelf achteruit mee.
- De agenda moet in de lijstweergave staan. De service zet die na elke login
  zelf goed, maar als het portaal die knop verplaatst, faalt het parsen met
  `Agenda element has not been found`.
- Absentie komt uit de kolom `.agenda-presence-icon`. Leeg betekent niets
  geregistreerd; `is-completed` betekent aanwezig; elk ander icoon wordt als
  niet-aanwezig geteld. Die laatste regel is bewust ruim: een gemiste absentie is
  erger dan een verkeerd gelabelde. De ruwe klasse staat in `absence_marker`, dus
  een onbekend icoon is zichtbaar in plaats van stil. Een aparte
  absentie-overzichtspagina wordt niet uitgelezen.
- De scraper is geschreven voor het studentenportaal. Een ouder-/verzorgerportaal
  heeft een andere indeling en werkt niet zonder aanpassing.
- Als de school 2FA met push-goedkeuring afdwingt in plaats van een code, werkt
  automatisch inloggen niet.
- In vakanties en lege weken meldt het portaal "Er zijn geen afspraken voor deze
  week". Dat wordt als een geldig, leeg resultaat behandeld: eerder opgehaalde
  dagen blijven staan en er komt geen foutmelding.

### Problemen oplossen

**Puppeteer start geen browser op macOS (`spawn Unknown system error -88`).**
Dat is `EBADEXEC`: macOS weigert de ongesigneerde Chrome die Puppeteer downloadt.
Draai de probe dan in de container, waar Chromium uit Alpine komt:

```
docker build --platform linux/amd64 -t eduarte-bridge .
docker run --rm --platform linux/amd64 --env-file .env \
  -e DATA_DIR=/data -e DISABLE_SANDBOX=true -v "$PWD/data:/data" \
  eduarte-bridge node dist/probe.js
```

**Login loopt vast.** Bij een mislukte login schrijft de service
`data/login-error.png` en `data/login-error.html` weg, zodat je ziet op welk
scherm hij bleef hangen — ook headless.

### Licentie

MIT — zie [LICENSE](LICENSE). De oorspronkelijke scraper is van reneax; de
Home Assistant-bridge is daar bovenop gebouwd.

### Verantwoording

Deze software logt in op een schoolportaal met de inloggegevens die je zelf
opgeeft, en leest alleen. Er wordt niets teruggeschreven naar Eduarte. Houd er
rekening mee dat je de gebruiksvoorwaarden van je eigen school volgt, en dat
geautomatiseerd inloggen bij een account met tweestapsverificatie betekent dat
het TOTP-secret op je eigen machine staat.
