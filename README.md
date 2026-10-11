# TLT Vol Desk

Where TLT calls and puts are cheap right now, on [Moontower](https://api.moontower.ai/docs) data.

**Live page:** https://21e8-miner.github.io/moontower-live/

What is on it, top to bottom:

- **Stat tiles**: spot, IV30 (hero), 1-year IV percentile, RV30, variance risk premium, term slope, 25Δ risk reversal.
- **Fig 1 · Skew balance**: an equal-arm balance drawn with the anatomy isometric kit. The left pan holds the put wing's 25Δ implied vol as a stack of weights, the right pan the call wing's. The beam tips toward the richer wing, so the pan that rises is where options are cheap, and the pointer swings toward the cheaper side. The dial reads the 1-year IV percentile. Hover to sweep expiries; arrow keys step. Picking an expiry here selects it everywhere on the page.
- **Cheap wing by expiry**: for every expiry to six months, the 25Δ call and 25Δ put with strike, mid, cost as % of spot, IV, breakeven and the move needed to reach it, plus which wing is cheaper. The lowest-IV call and put are flagged.
- **Implied-vol surface** (expiry × call delta, to six months) and **Moontower trade ideas for TLT**: where TLT ranks on each of Moontower's four preset screens across about 390 names, with the component scores.
- **IV30 vs RV30 history** (one year) and the **volatility cone**.

Every chart has a table view, hover and keyboard tooltips, and selected light and dark palettes.

## How the data flows

```
GitHub Actions (cron, holds MOONTOWER_API_KEY as a secret)
  └─ scripts/fetch_data.py  →  data/latest.json, data/history.json, data/featured/TLT.json
                                  └─ committed to main → GitHub Pages serves them
index.html + app.js  ←  fetch data/*.json (polls every 5 min for a new snapshot)
figure/build.mjs     →  figure/balance.{html,js,css} (the balance; rebuilt only when its geometry changes)
```

The API key never ships with the page. Snapshots refresh on weekdays at 14:05, 16:05, 18:05, 20:15 and 21:15 UTC
(Moontower's end-of-day snapshot lands at 16:00 ET = 20:00 UTC). A refresh is 15 API calls, about 30 credits.

### Live mode (bring your own key)

Click **Live key** and paste a Moontower key. It is stored only in your browser's localStorage and sent only to
`api.moontower.ai` (the API allows cross-origin requests). **Pull live now** re-fetches TLT on demand (about 28 credits).

## Running locally

```bash
export MOONTOWER_API_KEY=mtw_...
python3 scripts/fetch_data.py --seed-history 365   # first run: backfill a year of history
python3 -m http.server 8765                         # then open http://localhost:8765
```

To rebuild the balance after editing `figure/build.mjs` or `figure/model.mjs` (needs the anatomy skill at `~/.claude/skills/anatomy`), run `node figure/build.mjs`, then paste the new `figure/balance.html` over the `<figure class="iso-figure">…</figure>` block in `index.html`.

## Notes on units

- Vol endpoints (`impliedvol`, `realvol`, `ivrank`, `rviv`, chain IVs) are in percent; `cmiv` and `cockpit` IVs are decimals and are converted to percent in the fetch script.
- `VRP = 100 · ln(IV30 / RV30)`.
- Chain `dte` from Moontower is calendar days + 1; the page uses the surface's day count.
- Surface buckets `vol90 … vol10` are call deltas, so the left of the heatmap is the put wing.
- Trade-idea scores are cross-sectional: the fetch asks for Moontower's default universe and keeps TLT's rows with their rank. A single-name request scores everything zero.

Not investment advice.
