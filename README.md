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
| `assets/js/config.js` | Repo, names, and the sync token |
| `assets/js/store.js` | Reads/writes votes; falls back to local storage |
| `assets/js/app.js` | Rendering and interaction |
| `data/venues.json` | 33 venues, 6 categories. **Keep the `id` values** — votes reference them |
| `data/trip.json` | People, flights, accommodation, airport routes, phrases, schedule |
| `votes/all.json` | The shared result file. Written by the Action, read by the page |
| `.github/workflows/collect.yml` | Vote collector |

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

The page reads `votes/all.json` straight from GitHub. Writing needs a token, because a static page
can't keep a secret and GitHub won't take an anonymous write.

**Without a token** (how it ships): everyone sees the seeded votes, their own picks are saved on
their phone and copied to the clipboard on submit so they can paste them into the chat. Nothing
breaks, it just doesn't sync.

**With a token**: submitting fires a `repository_dispatch`; the Action checks the name against the
four-person whitelist, merges into `votes/all.json` and commits. Takes about 30 seconds; the page
polls and tells you when it lands.

To turn it on, make a token at **github.com/settings/personal-access-tokens/new**:

- Fine-grained, *Only select repositories* → this repo
- Repository permissions → **Contents: Read and write**
- Expiration 30 days

Paste it into `token` in `assets/js/config.js`, commit, done.

The trade-off: that token sits in a public file. Anyone who finds it can write to this repo and
nothing else. That's fine for a throwaway trip repo — **revoke it when you get home.**

## Credits

Venue photos: one supplied, the rest from Wikipedia / Wikimedia Commons under CC BY-SA, CC BY or
CC0. Several are illustrative stand-ins rather than the venue itself and are labelled as such on
the card.
