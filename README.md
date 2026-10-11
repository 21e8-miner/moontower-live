# TLT Vol Desk

Where TLT calls and puts are cheap right now, on [Moontower](https://api.moontower.ai/docs) data.

**Live page:** https://21e8-miner.github.io/moontower-live/

What is on it, top to bottom:

- **Stat tiles**: spot, IV30 (hero), 1-year IV percentile, RV30, variance risk premium, term slope, 25Δ risk reversal.
- **Fig 1 · Cheap wing by expiry**: for every expiry to six months, the 25Δ call and 25Δ put with strike, mid, cost as % of spot, IV, breakeven and the move needed to reach it, plus which wing is cheaper. The lowest-IV call and put are flagged. Click a row to select that expiry everywhere.
- **Fig 2 · Implied-vol surface**: expiry × call delta to six months, an ink ramp, the selected expiry outlined.
- **Fig 3 · Moontower trade ideas for TLT**: where TLT ranks on each of Moontower's four preset screens across about 390 names, with the component scores.
- **Fig 4 · IV30 vs RV30** over one year and **Fig 5 · the volatility cone**.

Every figure has a table view, hover and keyboard tooltips, a live readout in its footer, and selected light and dark palettes. The look follows the instrument idiom: paper tones, hairlines, monospace readouts, one lit accent for the selection.

## How the data flows

```
GitHub Actions (cron, holds MOONTOWER_API_KEY as a secret)
  └─ scripts/fetch_data.py  →  data/latest.json, data/history.json, data/featured/TLT.json
                                  └─ committed to main → GitHub Pages serves them
index.html + app.js  ←  fetch data/*.json (polls every 5 min for a new snapshot)
```

The API key never ships with the page. The action runs on weekdays at 14:05, 16:05, 18:05, 20:15 and 21:15 UTC
(Moontower's end-of-day snapshot lands at 16:00 ET = 20:00 UTC).

### Credits

Every successful Moontower call costs 2 credits. Each run starts with one `cockpit` call as a probe; if that row is the
one already on disk, the run stops there (2 credits). When the snapshot changed it makes six more calls, 14 credits in all:

| call | gives |
|---|---|
| `cockpit` | close, returns, IV10/30/90/6m, IV30 changes, RV7/30/90, term slopes, and ~5 days of history rows |
| `ivrank` | 1y/3m/1m IV rank and percentile |
| `rviv` | RV30, ATM IV, RV percentile, VRP |
| `skew` | 25Δ risk reversal and put skew with percentiles, per expiry |
| `volcone` | realized-vol range by window and ATM IV at each window |
| `optionchain` | prices, IVs and greeks; the delta surface is interpolated from its fitted vol |
| `trade-ideas` | the default universe, so TLT's rank is real (a single-name request scores everything zero) |

`impliedvol`, `price`, `cmiv`, `earnings` and `tickers` are no longer called; nothing shown on the page came only from them.
A worst-case week is 5 runs × 5 days × 14 credits = 350; a typical week, with one real change per day, is nearer 150.

### Live mode (bring your own key)

Click **Live key** and paste a Moontower key. It is stored only in your browser's localStorage and sent only to
`api.moontower.ai` (the API allows cross-origin requests). **Pull live now** re-fetches TLT with the same six calls (about 12 credits).

## Running locally

```bash
export MOONTOWER_API_KEY=mtw_...
python3 scripts/fetch_data.py --seed-history 365   # first run: backfill a year of history (2 calls per 31 days)
python3 scripts/fetch_data.py --force              # refresh even if the probe says nothing changed
python3 -m http.server 8765                         # then open http://localhost:8765
```

## Notes on units

- Vol endpoints (`realvol`, `ivrank`, `rviv`, chain IVs) are in percent; `cockpit` IVs are decimals and are converted to percent in the fetch script.
- `VRP = 100 · ln(IV30 / RV30)`.
- Chain `dte` from Moontower is calendar days + 1; the page subtracts one.
- Surface buckets `vol90 … vol10` are call deltas, so the left of the heatmap is the put wing.

Not investment advice.
