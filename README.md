# TLT Convexity Desk

Pricing a sharp long-bond rally in TLT calls, on [Moontower](https://api.moontower.ai/docs) data: where upside convexity is cheap, and where it only looks cheap.

**Live page:** https://21e8-miner.github.io/moontower-live/

The page is built around one question: if long Treasuries rally hard (about 100 bp, roughly +16% in TLT) inside a couple of months, which OTM call pays, and what does it cost to wait? Everything below the tiles is computed in the browser from the chain already on disk.

Top to bottom:

- **Tiles**: spot, IV30 (hero, with its 1-year percentile), vol risk premium, 25Δ risk reversal.
- **Target TLT** (filters row): type a future TLT price and a number of days. A line under the filters translates it into % and bp (duration 16), when TLT last traded there, and the chance of being there or touching it by the selected expiry at today's ATM vol; the shop gains an "at target" column (value and multiple after those days, IV flat) and the scenario grid a target row across 20–90 days. The page then auto-selects the **best risk/reward** line: the highest value ÷ premium at the target among liquid calls that outlive the horizon (max loss is the premium for all of them), badges it in the shop and keys Fig 2 to it. Deep link: `?p=90&n=60`.
- **Cost of vol**, one sentence: the IV percentile, the premium over realized, TLT's rank on Moontower's sell-front-vol screen, and whether the front or the back of the curve is the expensive shelf.
- **Fig 1 · Convexity shop**: one line per expiry to six months, the 25Δ, 15Δ or 10Δ call (pick the delta in the card), with strike, mid, cost as % of spot, IV, move to breakeven in % and bp, gamma per dollar of premium, theta per day as % of premium, half-life (days until the call is worth half its mid with spot unchanged), P(finish above breakeven), P(touch strike), and spread and open-interest flags. Click a row to select that expiry everywhere.
- **Fig 2 · If the rally arrives**: for the selected call, value ÷ premium when TLT reaches +5, +10 or +16% after 20, 40, 60 or 90 days, with IV unchanged or 3 points lower. Black-Scholes, zero drift, vol re-implied from the mid. *exp.* means the call expired before the move completed.
- **Fig 3 · Call IV by expiry**: ATM and the chosen delta's call IV across expiries, with scheduled events (FOMC verified; CPI, refunding and 30-year auctions approximate) marked on the axis. Hovering an event shows the extra move the surface prices across it.
- **Fig 4 · IV30 vs RV30 · 2023 analog**: one year of implied vs realized, with the autumn of 2023 in grey, its 2023-10-19 yield peak placed on today's date, so the analog rally and its IV path run forward from today.

Every figure has hover tooltips, a live readout in its footer, and selected light and dark palettes. The look follows the instrument idiom: paper tones, hairlines, monospace readouts, one lit accent for the selection.

## How the data flows

```
GitHub Actions (cron, holds MOONTOWER_API_KEY as a secret)
  └─ scripts/fetch_data.py  →  data/latest.json, data/history.json, data/featured/TLT.json
                                  └─ committed to main → GitHub Pages serves them
scripts/fetch_data.py --analog 2023-09-15:2023-12-31  →  data/analog_2023.json   (one-off, already committed)
index.html + app.js  ←  fetch data/*.json (polls every 5 min for a new snapshot); all option math runs in the browser
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
| `volcone` | realized-vol range by window (kept in the data file; not drawn) |
| `optionchain` | prices, IVs and greeks; the delta surface is interpolated from its fitted vol |
| `trade-ideas` | the default universe, so TLT's rank is real (a single-name request scores everything zero) |

A worst-case week is 5 runs × 5 days × 14 credits = 350; a typical week, with one real change per day, is nearer 150.
The shop, the scenario grid, the event premia and the probabilities add no credits.

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

- Vol endpoints (`ivrank`, `rviv`, chain IVs) are in percent; `cockpit` IVs are decimals and are converted to percent in the fetch script.
- `VRP = 100 · ln(IV30 / RV30)`.
- Chain `dte` from Moontower is calendar days + 1; the page subtracts one.
- Option math is Black-Scholes with forward = spot (TLT's distribution yield ≈ the funding rate) and the vol re-implied from each call's mid. P(touch) uses the reflection principle with log-drift −σ²/2. Half-life is solved by bisection on time with spot unchanged.
- Event premium: forward variance between adjacent expiries from ATM IV, less the median forward daily variance across gaps of five days or more, times the gap length, square-rooted.
- Duration translation: 1% of TLT ≈ 100/16 = 6.25 bp. An assumption, stated on the cards.

Not investment advice.
