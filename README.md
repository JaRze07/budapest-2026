# Budapest 2026

Trip site for four people — 28–31 August 2026. Pick your name, see your own flight and a
door-to-door route from the airport timed to your landing, vote on what to do and where to stay,
and look things up at 1am.

Static HTML, CSS and vanilla JS. No build step, no framework, no npm.

## Run it locally

Needs a web server — it loads JSON with `fetch`, so opening `index.html` from disk won't work.

```
python -m http.server 8000
# then http://localhost:8000
```

## Where things live

| Path | What it is |
| --- | --- |
| `index.html` | The whole app shell — four views, one page |
| `assets/js/config.js` | Database URL and the four names |
| `assets/js/store.js` | Reads/writes votes; falls back to local storage |
| `assets/js/app.js` | Rendering and interaction |
| `data/venues.json` | 33 venues, 6 categories. **Keep the `id` values** — votes reference them |
| `data/trip.json` | People, flights, accommodation, airport routes, phrases, schedule |
| `votes/all.json` | Offline fallback snapshot, used only if the database is unreachable |
| `database.rules.json` | Server-side write rules for the database |

## Editing content

Almost everything is data, not code.

**Add someone's flight** — find them in `data/trip.json` → `people`, set
`"flight_status": "confirmed"` and fill in `flights`. Copy the shape from Nhi (direct) or Jacek
(two legs). Everything else follows automatically: their countdown line, their airport route with
real clock times, their row on the arrivals board, and the "flight missing" banner disappears.

**Add accommodation options** — `data/trip.json` → `stay.vote.options`:

```json
{ "id": "flat-vii", "name": "Flat in District VII", "area": "Kazinczy u.",
  "desc": "One line.", "meta": "€x a night · sleeps 6", "image": "images/flat-vii.jpg" }
```

Drop the image in `images/`, or leave `image` out and it draws a lettered tile. The moment the
array is non-empty the Stay tab turns into a voting board with a submit bar.

**Add a venue** — `data/venues.json`, inside the right category. Put a 16:10 photo at
`images/{id}.jpg`.

## Vote syncing

Votes live in a Firebase Realtime Database (GCP project `budapest-2026-trip`, region
`europe-west1`), read and written over plain REST — no SDK, no key, no build step. A Server-Sent
Events stream keeps open pages in sync, so a vote cast on a phone appears on everyone else's screen
immediately.

There is no secret in the page and none is needed. The database is public-read, and
`database.rules.json` constrains writes server-side:

- only the four names may be written to
- records must be exactly `{ids, when}` — any extra field is rejected
- custom options are create-only
- nothing can be deleted, including the root

The worst anyone who finds the URL can do is cast a vote, which is what the name gate lets them do
anyway. Verified by testing: writes as an unknown name, deletes, extra fields and a root wipe are
all refused.

If the database is unreachable the page falls back to `votes/all.json` plus anything saved on the
phone, and replays pending writes once it's back.

### Changing the rules

```
gcloud auth print-access-token --impersonate-service-account=bp-admin@budapest-2026-trip.iam.gserviceaccount.com
curl -X PUT "$DB/.settings/rules.json" -H "Authorization: Bearer $TOKEN" --data-binary @database.rules.json
```

### Tearing it down after the trip

```
gcloud projects delete budapest-2026-trip
```

That removes the database, the service account and everything else in one go.

## Credits

Venue photos: one supplied, the rest from Wikipedia / Wikimedia Commons under CC BY-SA, CC BY or
CC0. Several are illustrative stand-ins rather than the venue itself and are labelled as such on
the card.
