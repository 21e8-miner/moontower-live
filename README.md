# TLT Convexity Desk

Pricing a sharp long-bond rally in TLT calls, on [Moontower](https://api.moontower.ai/docs) data: where the upside convexity is cheap, and where it only looks cheap.

**Live page:** https://21e8-miner.github.io/moontower-live/

The page is built around one thesis: a ~100 bp rally in long Treasuries (≈ +16% TLT, ≈ +24% EDV) inside about two months, expressed through OTM calls. Everything below the stat tiles is computed in the browser from the chain already on disk; no new API calls were added.

What is on it, top to bottom:

- **Event strip** (under the filters): FOMC Oct 27–28 and Dec 8–9 2026 and Jan 26–27 2027 (verified on federalreserve.gov; the 2027 date is tentative until the December meeting), the Nov 4 refunding announcement (Treasury's August statement), and the monthly CPI and 30-year auction slots (approximate: taken from calendar sites and the usual second-week pattern, marked *approx.* on the page). Each chip also shows the **event premium**: the extra move implied by the jump in ATM IV between the two expiries that bracket the date, over a baseline forward vol. Hover a chip for the gap.
- **Stat tiles**: spot, IV30 (hero), 1-year IV percentile, RV30, variance risk premium, term slope, 25Δ risk reversal.
- **Rent gauge**: what vol costs right now, in words: IV percentile, VRP, the IV30 change, TLT's Short Calendar and Sell Vol ranks from Moontower's screens, and ATM IV by shelf (≈30d / 90d / 180d, cheapest and richest expiry) from the surface. The lead sentence says whether the front or the back is the expensive part of the ticket.
- **Fig 1 · Upside convexity shop**: for every expiry to six months, the 25Δ, 15Δ and 10Δ calls (nearest call delta) with strike, mid, IV, cost as % of spot, breakeven and the move to it in % and in bp (duration 16 → 1% of TLT ≈ 6.25 bp), gamma, **gamma per dollar of premium** (the ranking column), theta per day as % of premium, half-life (days until the call is worth half its mid with spot unchanged), bid–ask width as % of mid, open interest, **P(finish above breakeven)** and **P(touch strike)** from the call's own IV (lognormal, zero drift), and which wing is cheaper for that expiry. Lines with spread > 10% of mid or OI < 1,000 are flagged. The rank-1 line is usually a weekly that decays 30–40% a day: the point of the ranking is to make that visible. Max loss is the premium. Click a line to select that expiry everywhere.
- **Fig 2 · Thesis grid**: for the selected expiry, the P&L multiple (value ÷ premium) of each shop line when TLT reaches +5%, +10% and +16% (≈ 31/63/100 bp) after 20, 40, 60 or 90 days, with IV unchanged and with IV −3 pts. Black-Scholes, zero drift, vol re-implied from each mid. The best line per scenario and IV case is outlined; a cell marked *exp.* means the call expired before the move completed (intrinsic on a straight-line path). The header shows each line's half-life.
- **Fig 3 · Implied-vol surface**: expiry × call delta to six months, an ink ramp, the selected expiry outlined.
- **Fig 4 · IV30 vs RV30 · 2023 analog**: one year of implied vs realized with TLT's close on a right axis, and in grey the autumn of 2023 with the 2023-10-19 yield peak placed on today's date: 2023 IV30 as it was, 2023 close rebased to today's close, running about 70 days past today. Hover past today to read the analog.
- **Fig 5 · Moontower trade ideas for TLT**: where TLT ranks on each of Moontower's four preset screens across about 390 names, with the component scores.
- **Fig 6 · the volatility cone**.
- **Fig 7 · EDV translator**: the same 100 bp rally in TLT calls, TLT shares, EDV shares and a low-coupon 2050 Treasury. Moontower has no EDV, ZROZ or TMF data, so this card is arithmetic on stated assumptions (TLT duration 16, EDV 24, ratio 1.5, so $N of EDV ≈ $1.5N of TLT; the 2050 bond at duration ≈ 22 and convexity ≈ 600). The call row is the selected expiry's line that does best on +16% in 60 days.

Every figure has hover and keyboard tooltips, a live readout in its footer, and selected light and dark palettes. The look follows the instrument idiom: paper tones, hairlines, monospace readouts, one lit accent for the selection.

## How the data flows

```
GitHub Actions (cron, holds MOONTOWER_API_KEY as a secret)
  └─ scripts/fetch_data.py  →  data/latest.json, data/history.json, data/featured/TLT.json
                                  └─ committed to main → GitHub Pages serves them
scripts/fetch_data.py --analog 2023-09-15:2023-12-31  →  data/analog_2023.json   (one-off, run once by hand)
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
| `volcone` | realized-vol range by window and ATM IV at each window |
| `optionchain` | prices, IVs and greeks; the delta surface is interpolated from its fitted vol |
| `trade-ideas` | the default universe, so TLT's rank is real (a single-name request scores everything zero) |

`impliedvol`, `price`, `cmiv`, `earnings` and `tickers` are no longer called; nothing shown on the page came only from them.
A worst-case week is 5 runs × 5 days × 14 credits = 350; a typical week, with one real change per day, is nearer 150.

The convexity shop, thesis grid, rent gauge, event premia, probabilities and EDV translator all compute from `data/featured/TLT.json`
and `data/latest.json`, so they add **no** credits to the scheduled refresh.

| one-off | calls | credits | gives |
|---|---|---|---|
| `--analog 2023-09-15:2023-12-31` | 4 × `cockpit` (31-day windows) | 8 | close, IV10/30/90 and RV30 for the 2023 analog (`data/analog_2023.json`, committed; never re-run by the action) |

### Live mode (bring your own key)

Click **Live key** and paste a Moontower key. It is stored only in your browser's localStorage and sent only to
`api.moontower.ai` (the API allows cross-origin requests). **Pull live now** re-fetches TLT with the same six calls (about 12 credits).

## Running locally

```bash
export MOONTOWER_API_KEY=mtw_...
python3 scripts/fetch_data.py --seed-history 365   # first run: backfill a year of history (2 calls per 31 days)
python3 scripts/fetch_data.py --force              # refresh even if the probe says nothing changed
python3 scripts/fetch_data.py --analog 2023-09-15:2023-12-31   # one-off 2023 analog (4 calls); already committed
python3 -m http.server 8765                         # then open http://localhost:8765
```

## Notes on units

- Vol endpoints (`realvol`, `ivrank`, `rviv`, chain IVs) are in percent; `cockpit` IVs are decimals and are converted to percent in the fetch script.
- `VRP = 100 · ln(IV30 / RV30)`.
- Chain `dte` from Moontower is calendar days + 1; the page subtracts one.
- Surface buckets `vol90 … vol10` are call deltas, so the left of the heatmap is the put wing.
- Option math on the page is Black-Scholes with forward = spot (TLT's distribution yield ≈ the funding rate) and the vol re-implied from each call's mid, which sits within about half a point of Moontower's `call_mid_iv`. P(touch) uses the reflection principle with log-drift −σ²/2. Half-life is solved by bisection on time with spot unchanged.
- Event premium: forward variance between adjacent expiries from ATM IV, `(σ_j² T_j − σ_i² T_i) / (T_j − T_i)`, less the median forward daily variance across gaps of five days or more, times the gap length, square-rooted.
- Duration translation: 1% of TLT ≈ 100/16 = 6.25 bp; EDV/TLT ≈ 24/16 = 1.5. These are assumptions, stated on the cards.

Not investment advice.
