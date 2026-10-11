# Vol Desk · Moontower

A live options-volatility dashboard built on the [Moontower API](https://api.moontower.ai/docs).

**Live page:** https://21e8-miner.github.io/moontower-live/

What it shows for a selected name:

- stat tiles: spot, IV30 (hero), 1-year IV percentile, RV30, variance risk premium, term slope, 25Δ risk reversal
- implied-vol surface heatmap (expiry × call delta) — click a row to select that expiry
- volatility cone (1-year realized range by window vs today's realized and ATM implied)
- one-year IV30 vs RV30 history with a crosshair tooltip and 1M/3M/6M/1Y range
- skew by delta for the selected expiry, every other expiry in gray for context
- gamma by strike for the selected expiry, peak-gamma strike highlighted
- option chain around spot with breakevens and the move needed to reach them
- a sortable cross-asset vol board (40 names) with IV30 sparklines
- Moontower's preset trade-idea screens

Every chart has a table view, a hover/focus tooltip, and selected light/dark palettes.

## How the data flows

```
GitHub Actions (cron, holds MOONTOWER_API_KEY as a secret)
  └─ scripts/fetch_data.py  →  data/latest.json, data/history.json, data/featured/<T>.json
                                  └─ committed to main → GitHub Pages serves them
index.html + app.js  ←  fetch data/*.json (polls every 5 min for a new snapshot)
```

The API key never ships with the page. Snapshots refresh on weekdays at 14:05, 16:05, 18:05, 20:15 and 21:15 UTC
(Moontower's end-of-day snapshot lands at 16:00 ET = 20:00 UTC). Each refresh costs about 60 credits
(2 per call; 7 board calls, 3 history calls, 3 per featured name, 1 trade-ideas call).

### Live mode (bring your own key)

Click **Live key** and paste a Moontower key. It is stored only in your browser's localStorage and sent only to
`api.moontower.ai` (the API allows cross-origin requests). You can then load any of the 40 names on demand
(~8 credits) or re-pull the whole board (~14 credits).

## Running locally

```bash
export MOONTOWER_API_KEY=mtw_...
python3 scripts/fetch_data.py --seed-history 365   # first run: backfill a year of history
python3 -m http.server 8765                         # then open http://localhost:8765
```

Edit `UNIVERSE` and `FEATURED` in `scripts/fetch_data.py` to change the names; `FEATURED` names get the full
surface / cone / chain pre-fetched for viewers without a key.

## Notes on units

- Vol endpoints (`impliedvol`, `realvol`, `ivrank`, `rviv`, chain IVs) are in percent; `cmiv` and `cockpit` IVs are decimals and are converted to percent in the fetch script.
- `VRP = 100 · ln(IV30 / RV30)`.
- Chain `dte` from Moontower is calendar days + 1; the captions use the surface's day count.
- Surface buckets `vol90 … vol10` are call deltas, so the left of the heatmap is the put wing.

Not investment advice.
