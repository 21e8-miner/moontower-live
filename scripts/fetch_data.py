#!/usr/bin/env python3
"""
Pull Moontower (api.moontower.ai) snapshots for TLT into ./data so the static site renders
without a key. Standard library only.

  python3 scripts/fetch_data.py                      # probe; full refresh only when the snapshot changed
  python3 scripts/fetch_data.py --force              # refresh even if the probe says unchanged
  python3 scripts/fetch_data.py --seed-history 365   # also backfill a year of history (2 calls per 31 days)

Credits: every successful /v1 call costs 2. A refresh is 1 call when nothing changed (the cockpit probe),
7 calls when it did: cockpit, ivrank, rviv, skew, volcone, optionchain, trade-ideas. The IV surface
by delta is derived from the chain's smoothed vol, so /v1/impliedvol is not called; close and the
30-day history come from cockpit and rviv, so /v1/price and /v1/cmiv are not called either.

The key comes from MOONTOWER_API_KEY, else ~/.config/active_projects_secrets/moontower_api_key.
It is never written anywhere.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.moontower.ai"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

TICKER = "TLT"
CATEGORY = "Fixed Income"
DELTAS = [90, 80, 70, 60, 50, 40, 30, 20, 10]
MAX_STRIKES_PER_EXPIRY = 60
MAX_DTE = 420

CHAIN_FIELDS = {
    "expiry_date": "exp", "dte": "dte", "strike": "k",
    "call_bid_price": "cb", "call_mid_price": "cm", "call_ask_price": "ca",
    "put_bid_price": "pb", "put_mid_price": "pm", "put_ask_price": "pa",
    "call_mid_iv": "civ", "put_mid_iv": "piv", "smoothed_vol": "siv",
    "call_delta": "cd", "put_delta": "pd", "call_gamma": "g", "call_theta": "ct", "put_theta": "pt",
    "call_vega": "v", "call_open_interest": "coi", "put_open_interest": "poi",
    "call_volume": "cvol", "put_volume": "pvol",
}


class ApiError(RuntimeError):
    pass


def load_key() -> str:
    k = os.environ.get("MOONTOWER_API_KEY", "").strip()
    if k:
        return k
    path = os.path.expanduser("~/.config/active_projects_secrets/moontower_api_key")
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        sys.exit("No key: set MOONTOWER_API_KEY")


class Client:
    def __init__(self, key: str):
        self.key = key
        self.calls = 0

    def get(self, path: str, **params):
        pairs = []
        for k, v in params.items():
            if v is None:
                continue
            if isinstance(v, (list, tuple)):
                pairs += [(k, str(x)) for x in v]
            else:
                pairs.append((k, str(v)))
        url = BASE + path + ("?" + urllib.parse.urlencode(pairs) if pairs else "")
        for attempt in range(4):
            req = urllib.request.Request(url, headers={"X-API-Key": self.key, "Accept": "application/json",
                                                        "User-Agent": "moontower-live/2.0"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    self.calls += 1
                    return json.loads(r.read().decode())
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")[:300]
                if e.code in (401, 402, 403):
                    raise ApiError(f"{e.code} on {path}: {body}")
                if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ApiError(f"{e.code} on {path}: {body}")
            except urllib.error.URLError as e:
                if attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ApiError(f"network error on {path}: {e}")
        raise ApiError(f"gave up on {path}")

    def rows(self, path: str, **params):
        d = self.get(path, **params)
        return d.get("data", d) if isinstance(d, dict) else d


def r(x, n=4):
    return None if x is None else round(float(x), n)


def x100(v, n=2):
    return None if v is None else round(float(v) * 100, n)


def newest(rows):
    """Endpoints return several days, newest first but not guaranteed: take the latest date."""
    rows = [x for x in (rows or []) if x.get("date")]
    return max(rows, key=lambda x: x["date"]) if rows else {}


def nearest(rows, field, target):
    best = None
    for row in rows:
        v = row.get(field)
        if v is None:
            continue
        if best is None or abs(v - target) < abs(best.get(field) - target):
            best = row
    return best


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, path)


# ---------------------------------------------------------------- chain → trimmed chain + delta surface
def trim_chain(chain, spot):
    """Keep expiries to MAX_DTE and the strikes nearest spot per expiry, with short field names."""
    per_exp = {}
    for row in chain:
        if row.get("dte") is None or row["dte"] <= 0 or row["dte"] > MAX_DTE:
            continue
        k = row.get("strike")
        sp = row.get("spot_price") or spot
        if k is None or sp is None:
            continue
        per_exp.setdefault(row["expiry_date"], []).append((abs(k - sp), row))
    out = []
    for exp in sorted(per_exp):
        rows = [row for _, row in sorted(per_exp[exp], key=lambda t: t[0])[:MAX_STRIKES_PER_EXPIRY]]
        for row in sorted(rows, key=lambda x: x["strike"]):
            o = {}
            for src, dst in CHAIN_FIELDS.items():
                v = row.get(src)
                o[dst] = r(v, 5) if isinstance(v, float) else v
            out.append(o)
    return out


def surface_from_chain(trimmed, spot, date):
    """Implied vol at 90…10 call delta per expiry, interpolated on the chain's smoothed (fitted) vol.
    Same row shape as /v1/impliedvol so the page needs no change. Chain dte is calendar days + 1."""
    per_exp = {}
    for row in trimmed:
        if row.get("siv") is not None and row.get("cd") is not None:
            per_exp.setdefault(row["exp"], []).append(row)
    out = []
    for exp in sorted(per_exp):
        rows = sorted(per_exp[exp], key=lambda x: -x["cd"])           # delta falls as strike rises
        o = {"date": date, "expiry_date": exp, "dte": rows[0]["dte"] - 1, "spot_price": spot}
        for d in DELTAS:
            t = d / 100
            val = None
            for a, b in zip(rows, rows[1:]):
                if a["cd"] >= t >= b["cd"]:
                    span = a["cd"] - b["cd"]
                    w = 0 if span == 0 else (a["cd"] - t) / span
                    val = a["siv"] + (b["siv"] - a["siv"]) * w
                    break
            o["vol%d" % d] = r(val, 2)
        if any(o["vol%d" % d] is not None for d in DELTAS):
            out.append(o)
    return out


# ---------------------------------------------------------------- history
def history_load():
    out = {}
    for t, arr in read_json(os.path.join(DATA, "history.json"), {}).items():
        out[t] = {row["d"]: {k: v for k, v in row.items() if k != "d"} for row in arr}
    return out


def history_merge(history, cockpit_rows, rviv_rows):
    for row in cockpit_rows:
        h = history.setdefault(row["ticker"], {}).setdefault(row["date"], {})
        if row.get("close") is not None:
            h["c"] = r(row["close"], 4)
        for src, dst in (("iv_10d", "iv10"), ("iv_30d", "iv30"), ("iv_90d", "iv90")):
            if row.get(src) is not None:
                h[dst] = x100(row[src])
        if row.get("rv_30d") is not None:
            h["rv30"] = r(row["rv_30d"], 2)
    for row in rviv_rows:
        h = history.setdefault(row["ticker"], {}).setdefault(row["date"], {})
        for src, dst, n in (("rv_30d", "rv30", 2), ("atmiv", "atmiv", 2), ("vrp", "vrp", 2), ("rv_percentile", "rvp", 1)):
            if row.get(src) is not None:
                h[dst] = r(row[src], n)
    return history


def history_write(history):
    out = {t: [dict(d=d, **v) for d, v in sorted(days.items())][-400:] for t, days in history.items()}
    write_json(os.path.join(DATA, "history.json"), out)


def fetch_window(c, start, end):
    s, e = start.isoformat(), end.isoformat()
    return (c.rows("/v1/cockpit", ticker=TICKER, start_date=s, end_date=e),
            c.rows("/v1/rviv", ticker=TICKER, start_date=s, end_date=e))


def business_days_between(a: str, b: str) -> int:
    d0, d1 = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    n, d = 0, d0
    while d < d1:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-history", type=int, default=0, help="backfill N days of history (31-day windows, 2 calls each)")
    ap.add_argument("--force", action="store_true", help="refresh even when the probe says the snapshot is unchanged")
    args = ap.parse_args()

    c = Client(load_key())
    today = dt.date.today()
    prev = read_json(os.path.join(DATA, "latest.json"), {})
    prev_row = (prev.get("universe") or [{}])[0]

    # ---- probe: one call. If the cockpit row is the one we already have, stop here.
    ck_rows = c.rows("/v1/cockpit", ticker=TICKER)
    ck = newest(ck_rows)
    if not ck.get("date"):
        sys.exit("cockpit returned no row")
    same = (prev_row.get("date") == ck.get("date") and prev_row.get("snapshot_at") == ck.get("snapshot_at")
            and prev_row.get("close") == r(ck.get("close")) and prev_row.get("iv30") == x100(ck.get("iv_30d")))
    if same and not args.force and not args.seed_history:
        print(f"unchanged: {ck['date']} snapshot {ck.get('snapshot_at')} · 1 call (2 credits)", file=sys.stderr)
        return

    # ---- the rest of the cross-section (3 calls) and the detail (2) and ideas (1)
    ir = newest(c.rows("/v1/ivrank", ticker=TICKER))
    rv_rows = c.rows("/v1/rviv", ticker=TICKER)
    rv = newest(rv_rows)
    skew = [s for s in c.rows("/v1/skew", ticker=TICKER) if s.get("maturity") is not None]
    sk30 = nearest([s for s in skew if s.get("risk_reversal_25d") is not None], "maturity", 30) or {}
    cone = c.rows("/v1/volcone", ticker=TICKER)
    chain = c.rows("/v1/optionchain", ticker=TICKER)
    spot = next((row["spot_price"] for row in chain if row.get("spot_price")), ck.get("current_price") or ck.get("close"))
    snapshot_at = next((row["snapshot_at"] for row in chain if row.get("snapshot_at")), None)

    universe = [{
        "ticker": TICKER, "category": CATEGORY, "date": ck.get("date"),
        "snapshot_at": ck.get("snapshot_at") or snapshot_at,
        "close": r(ck.get("close")), "spot": r(spot),
        "ret_1d": r(ck.get("daily_return"), 5), "ret_1w": r(ck.get("weekly_return"), 5), "ret_1m": r(ck.get("monthly_return"), 5),
        "sd_200": r(ck.get("sd_from_200ma"), 3),
        "iv10": x100(ck.get("iv_10d")), "iv30": x100(ck.get("iv_30d")), "iv90": x100(ck.get("iv_90d")), "iv6m": x100(ck.get("iv_6m")),
        "iv30_chg_1d": x100(ck.get("iv_30d_daily_change")), "iv30_chg_1w": x100(ck.get("iv_30d_weekly_change")), "iv30_chg_1m": x100(ck.get("iv_30d_monthly_change")),
        "iv_rank_1y": r(ir.get("iv_rank_1y"), 1), "iv_pct_1y": r(ir.get("iv_pct_1y"), 1), "iv_pct_3m": r(ir.get("iv_pct_3m"), 1), "iv_pct_1m": r(ir.get("iv_pct_1m"), 1),
        "rv7": r(ck.get("rv_7d"), 2), "rv30": r(rv.get("rv_30d") if rv.get("rv_30d") is not None else ck.get("rv_30d"), 2), "rv90": r(ck.get("rv_90d"), 2),
        "rv_pct": r(rv.get("rv_percentile"), 1), "vrp": r(rv.get("vrp"), 2),
        "term_30_10": r(ck.get("term_structure_30d_10d"), 4), "term_90_30": r(ck.get("term_structure_90d_30d"), 4),
        "rr25": r(sk30.get("risk_reversal_25d"), 4), "rr25_pct": r(sk30.get("risk_reversal_25d_percentile"), 1),
        "skew25p": r(sk30.get("skew_25d_put"), 4), "skew25p_pct": r(sk30.get("skew_25d_put_percentile"), 1),
        "skew25c_pct": r(sk30.get("skew_25d_call_percentile"), 1), "skew_maturity": sk30.get("maturity"),
    }]

    # ---- trade ideas: the default universe, since scores are cross-sectional (a lone ticker scores 0)
    ideas_out = prev.get("ideas")
    try:
        ideas = c.get("/v1/trade-ideas")
        keep = ["ticker", "idea", "category", "iv30d", "realizedVol", "vrpLevel", "termStructureRatio", "ivPercentile",
                "vrpPercentile", "rvPercentile", "steepnessPercentile", "currentPrice", "skew25dPutPercentile",
                "skew25dCallPercentile", "ivScore", "vrpScore", "rvScore", "steepnessScore", "totalScore"]
        slim = [{k: (r(v, 3) if isinstance(v, float) else v) for k, v in row.items() if k in keep} for row in ideas.get("tickers", [])]
        summary = ideas.get("summary") or {}
        mine = []
        for idea in sorted(set(x["idea"] for x in slim)):
            group = sorted((x for x in slim if x["idea"] == idea), key=lambda x: -(x.get("totalScore") or -1e9))
            for rank, row in enumerate(group, 1):
                if row["ticker"] == TICKER:
                    mine.append(dict(row, rank=rank, of=len(group), top=[g["ticker"] for g in group[:3]]))
        ideas_out = {
            "generated_at": ideas.get("generatedAt"), "trade_date": summary.get("tradeDate"), "snapshot_at": summary.get("snapshotAt"),
            "note": summary.get("note") or summary.get("tradeDateNote"),
            "universe_size": summary.get("uniqueTickerCount") or len(set(x["ticker"] for x in slim)),
            "means": summary.get("crossSectionalMeans"),
            "rows": sorted(mine, key=lambda x: -(x.get("totalScore") or -1e9)),
        }
    except ApiError as e:
        print("trade-ideas skipped:", e, file=sys.stderr)

    # ---- history: today's row comes from the calls above; backfill only when days are missing
    history = history_load()
    history_merge(history, [dict(row, ticker=TICKER) for row in ck_rows if row.get("date")], rv_rows or [])   # the probe returns ~5 days: keep them all
    days = sorted(history.get(TICKER, {}))
    last_before = next((d for d in reversed(days) if d < ck["date"]), None)
    gap = business_days_between(last_before, ck["date"]) if last_before else 999
    windows = []
    if gap > 1 and not args.seed_history:
        windows.append((dt.date.fromisoformat(ck["date"]) - dt.timedelta(days=min(31, 7 + 2 * gap)), today))
    if args.seed_history:
        end = today
        while (today - end).days < args.seed_history:
            windows.append((end - dt.timedelta(days=30), end))
            end = end - dt.timedelta(days=31)
    for start, end in windows:
        ckr, rvr = fetch_window(c, start, end)
        history_merge(history, ckr, rvr)
        print(f"history {start}..{end}: {len(ckr)} rows", file=sys.stderr)
    history_write(history)

    # ---- detail file
    trimmed = trim_chain(chain, spot)
    write_json(os.path.join(DATA, "featured", f"{TICKER}.json"), {
        "ticker": TICKER, "as_of": ck.get("date"), "snapshot_at": snapshot_at, "spot": spot,
        "surface": surface_from_chain(trimmed, spot, ck.get("date")),
        "cone": [{k: (r(v, 3) if isinstance(v, float) else v) for k, v in row.items() if k != "ticker"} for row in cone],
        "skew": [{k: (r(v, 4) if isinstance(v, float) else v) for k, v in row.items() if k not in ("ticker", "snapshot_at", "date")}
                 for row in skew if row.get("maturity", 0) <= MAX_DTE],
        "chain": trimmed,
    })

    write_json(os.path.join(DATA, "latest.json"), {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "as_of": ck.get("date"), "universe": universe, "featured": [TICKER], "ideas": ideas_out, "api_calls": c.calls,
    })
    print(f"done: {ck['date']} · {len(trimmed)} chain rows · api calls={c.calls} (~{2 * c.calls} credits)", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except ApiError as e:
        sys.exit(f"Moontower API error: {e}")
