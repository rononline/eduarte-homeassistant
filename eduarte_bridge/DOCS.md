# Eduarte bridge

Haalt rooster, huiswerk en aanwezigheidsregistratie uit het Eduarte
studentenportaal en biedt die aan Home Assistant aan.

## Instellen

| Optie | Toelichting |
|---|---|
| `portal_url` | De URL van het portaal van je school, bijvoorbeeld `https://<school>.educus.nl` |
| `eduarte_email` | Het e-mailadres van het schoolaccount |
| `eduarte_password` | Het wachtwoord |
| `totp_secret` | TOTP-secret uit de QR-code van de 2FA-instelling; leeg als er geen 2FA is |
| `is_microsoft_login` | Aan bij Microsoft SSO, uit bij een eigen Eduarte-login |
| `api_token` | Zelfgekozen geheim dat elk verzoek moet meesturen; sterk aangeraden |
| `calendar_name` | Naam die in de kalender-feed staat |
| `placement_names` | Agenda-items met deze namen tellen als stage in plaats van les (standaard `BPV`) |
| `refresh_interval` | Minuten tussen ophaalacties (standaard 30) |
| `weeks_ahead` | Hoeveel weken vooruit het rooster wordt opgehaald (standaard 4) |
| `history_days` | Hoeveel dagen verleden bewaard blijft (standaard 90) |

Na het starten hoort er in het logboek te staan:

```
Logged into Eduarte.
Agenda refreshed: N day(s), M lesson(s).
```

## Koppelen

**Kalender** — Instellingen → Apparaten & diensten → Integratie toevoegen →
*Remote Calendar*, met als URL:

```
http://<ip-van-je-ha>:8099/calendar.ics?token=<api_token>
```

**Sensoren** — kopieer `homeassistant/eduarte.yaml` uit de repository naar
`/config/packages/eduarte.yaml` en volg de instructies in de kop van dat bestand.

> Let op: bij een wijziging aan een bestaande sensor is `rest.reload` niet genoeg.
> Home Assistant negeert de nieuwe definitie dan stilzwijgend omdat het `unique_id`
> al bestaat. Herstart Home Assistant volledig.

## Endpoints

| Pad | Inhoud |
|---|---|
| `GET /calendar.ics` | Het rooster als iCalendar |
| `GET /state.json` | Huidige/volgende les, lessen vandaag en morgen, absentie, huiswerk |
| `POST /refresh` | Forceert direct een ophaalronde |
| `GET /health` | Status voor de watchdog; vereist geen token |

## Werkt het bij jouw school niet?

Eduarte draait bij elke school als eigen instantie met eigen HTML. Zet `debug`
aan en bekijk het logboek. Faalt het parsen, dan staat in de
[repository](https://github.com/rononline/eduarte-homeassistant) beschreven hoe je
met `npm run probe` de ruwe pagina bekijkt en de selectors aanpast.
