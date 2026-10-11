#!/usr/bin/env python3
"""
Pull Moontower (api.moontower.ai) snapshots into ./data so the static site can render
without a key. Standard library only.

  python3 scripts/fetch_data.py                 # refresh universe + featured + last 31 days
  python3 scripts/fetch_data.py --seed-history 365   # also backfill a year of history

The key comes from MOONTOWER_API_KEY, else ~/.config/active_projects_secrets/moontower_api_key.
It is never written anywhere. Every successful /v1 call costs 2 credits.
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

UNIVERSE = [
    "SPY", "QQQ", "IWM", "DIA", "EEM", "EFA", "FXI",
    "TLT", "IEF", "HYG", "LQD",
    "GLD", "SLV", "USO", "UNG",
    "XLE", "XLF", "XLK", "XLV", "SMH", "KRE", "ARKK",
    "NVDA", "AAPL", "MSFT", "AMZN", "TSLA", "META", "GOOGL", "AMD", "NFLX", "JPM", "XOM", "PLTR", "GME",
    "COIN", "MSTR", "IBIT",
    "VXX", "UVXY",
]
FEATURED = ["TLT", "SPY", "QQQ", "NVDA", "GLD", "TSLA"]

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
                                                        "User-Agent": "moontower-live/1.0"})
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


def by_ticker(rows):
    out = {}
    for row in rows:
        out.setdefault(row["ticker"], []).append(row)
    return out


def nearest(rows, field, target):
    best = None
    for row in rows:
        v = row.get(field)
        if v is None:
            continue
        if best is None or abs(v - target) < abs(best.get(field) - target):
            best = row
    return best


MAX_STRIKES_PER_EXPIRY = 60


def trim_chain(chain, spot):
    """Keep expiries up to 420 dte and the 60 strikes nearest spot per expiry, short field names."""
    per_exp = {}
    for row in chain:
        if row.get("dte") is None or row["dte"] <= 0 or row["dte"] > 420:
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


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, path)


def merge_history(history, tickers, price_rows, cmiv_rows, rviv_rows):
    """history: {ticker: {date: {...}}}"""
    for t in tickers:
        history.setdefault(t, {})
    for row in price_rows:
        h = history.setdefault(row["ticker"], {}).setdefault(row["date"], {})
        h["c"] = r(row.get("close"), 4)
    for row in cmiv_rows:
        h = history.setdefault(row["ticker"], {}).setdefault(row["date"], {})
        for src, dst in (("iv_10d", "iv10"), ("iv_30d", "iv30"), ("iv_90d", "iv90"), ("iv_1y", "iv1y")):
            if row.get(src) is not None:
                h[dst] = r(row[src] * 100, 2)      # cmiv is decimal -> percent
    for row in rviv_rows:
        h = history.setdefault(row["ticker"], {}).setdefault(row["date"], {})
        if row.get("rv_30d") is not None:
            h["rv30"] = r(row["rv_30d"], 2)
        if row.get("atmiv") is not None:
            h["atmiv"] = r(row["atmiv"], 2)
        if row.get("vrp") is not None:
            h["vrp"] = r(row["vrp"], 2)
        if row.get("rv_percentile") is not None:
            h["rvp"] = r(row["rv_percentile"], 1)
    return history


def fetch_window(c, tickers, start, end):
    s, e = start.isoformat(), end.isoformat()
    price = c.rows("/v1/price", ticker=tickers, start_date=s, end_date=e)
    cmiv = c.rows("/v1/cmiv", ticker=tickers, start_date=s, end_date=e)
    rviv = c.rows("/v1/rviv", ticker=tickers, start_date=s, end_date=e)
    return price, cmiv, rviv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-history", type=int, default=0, help="backfill N days of history (31-day windows)")
    ap.add_argument("--no-featured", action="store_true")
    args = ap.parse_args()

    c = Client(load_key())
    today = dt.date.today()
    tickers = UNIVERSE

    # ---- cross-section (one call per endpoint for the whole universe)
    price = by_ticker(c.rows("/v1/price", ticker=tickers))
    cmiv = by_ticker(c.rows("/v1/cmiv", ticker=tickers))
    ivrank = by_ticker(c.rows("/v1/ivrank", ticker=tickers))
    rviv = by_ticker(c.rows("/v1/rviv", ticker=tickers))
    cockpit = by_ticker(c.rows("/v1/cockpit", ticker=tickers))
    skew = by_ticker(c.rows("/v1/skew", ticker=tickers))
    try:
        earnings = {row["ticker"]: row for row in c.rows("/v1/earnings", ticker=tickers)}
    except ApiError as e:
        print("earnings skipped:", e, file=sys.stderr)
        earnings = {}
    directory = {row["ticker"]: row.get("category") for row in c.rows("/v1/tickers")}

    universe = []
    as_of = None
    for t in tickers:
        p = (price.get(t) or [{}])[-1]
        cm = (cmiv.get(t) or [{}])[-1]
        ir = (ivrank.get(t) or [{}])[-1]
        rv = (rviv.get(t) or [{}])[-1]
        ck = (cockpit.get(t) or [{}])[-1]
        sk30 = nearest([s for s in skew.get(t, []) if s.get("risk_reversal_25d") is not None], "maturity", 30) or {}
        if p.get("date"):
            as_of = max(as_of or "", p["date"])
        universe.append({
            "ticker": t,
            "category": directory.get(t),
            "date": p.get("date"),
            "snapshot_at": p.get("snapshot_at"),
            "close": r(p.get("close")),
            "ret_1d": r(ck.get("daily_return"), 5),
            "ret_1w": r(ck.get("weekly_return"), 5),
            "ret_1m": r(ck.get("monthly_return"), 5),
            "sd_200": r(ck.get("sd_from_200ma"), 3),
            "iv10": r(cm.get("iv_10d", 0) * 100 if cm.get("iv_10d") is not None else None, 2),
            "iv30": r(cm.get("iv_30d", 0) * 100 if cm.get("iv_30d") is not None else None, 2),
            "iv60": r(cm.get("iv_60d", 0) * 100 if cm.get("iv_60d") is not None else None, 2),
            "iv90": r(cm.get("iv_90d", 0) * 100 if cm.get("iv_90d") is not None else None, 2),
            "iv6m": r(cm.get("iv_6m", 0) * 100 if cm.get("iv_6m") is not None else None, 2),
            "iv1y": r(cm.get("iv_1y", 0) * 100 if cm.get("iv_1y") is not None else None, 2),
            "iv30_chg_1d": r((ck.get("iv_30d_daily_change") or 0) * 100 if ck.get("iv_30d_daily_change") is not None else None, 2),
            "iv30_chg_1w": r((ck.get("iv_30d_weekly_change") or 0) * 100 if ck.get("iv_30d_weekly_change") is not None else None, 2),
            "iv_rank_1y": r(ir.get("iv_rank_1y"), 1),
            "iv_pct_1y": r(ir.get("iv_pct_1y"), 1),
            "iv_pct_3m": r(ir.get("iv_pct_3m"), 1),
            "iv_pct_1m": r(ir.get("iv_pct_1m"), 1),
            "rv7": r(ck.get("rv_7d"), 2),
            "rv30": r(rv.get("rv_30d"), 2),
            "rv90": r(ck.get("rv_90d"), 2),
            "rv_pct": r(rv.get("rv_percentile"), 1),
            "vrp": r(rv.get("vrp"), 2),                    # 100*ln(IV30/RV30)
            "term_30_10": r(ck.get("term_structure_30d_10d"), 4),
            "term_90_30": r(ck.get("term_structure_90d_30d"), 4),
            "rr25": r(sk30.get("risk_reversal_25d"), 4),
            "rr25_pct": r(sk30.get("risk_reversal_25d_percentile"), 1),
            "skew25p": r(sk30.get("skew_25d_put"), 4),
            "skew25p_pct": r(sk30.get("skew_25d_put_percentile"), 1),
            "skew25c_pct": r(sk30.get("skew_25d_call_percentile"), 1),
            "skew_maturity": sk30.get("maturity"),
            "next_earnings": (earnings.get(t) or {}).get("next_earnings_date"),
        })

    # ---- trade ideas (free-form)
    ideas_out = None
    try:
        ideas = c.get("/v1/trade-ideas")
        rows = ideas.get("tickers", [])
        keep = ["ticker", "idea", "category", "iv30d", "realizedVol", "vrpLevel", "termStructureRatio", "ivPercentile",
                "vrpPercentile", "rvPercentile", "steepnessPercentile", "currentPrice", "skew25dPutPercentile",
                "skew25dCallPercentile", "ivScore", "vrpScore", "rvScore", "steepnessScore", "totalScore"]
        slim = [{k: (r(v, 3) if isinstance(v, float) else v) for k, v in row.items() if k in keep} for row in rows]
        kept = []
        for idea in sorted(set(x["idea"] for x in slim)):
            group = sorted((x for x in slim if x["idea"] == idea), key=lambda x: -(x.get("totalScore") or -1e9))
            kept += [x for i, x in enumerate(group) if i < 30 or x["ticker"] in tickers]
        ideas_out = {
            "generated_at": ideas.get("generatedAt"),
            "trade_date": (ideas.get("summary") or {}).get("tradeDate"),
            "universe_size": len(set(x["ticker"] for x in slim)),
            "rows": kept,
        }
    except ApiError as e:
        print("trade-ideas skipped:", e, file=sys.stderr)

    # ---- history (merge last 31 days; optional backfill)
    hist_path = os.path.join(DATA, "history.json")
    history = {}
    try:
        with open(hist_path) as f:
            for t, arr in json.load(f).items():          # stored as sorted arrays; merge wants dicts
                history[t] = {row["d"]: {k: v for k, v in row.items() if k != "d"} for row in arr}
    except (OSError, ValueError):
        history = {}
    windows = [(today - dt.timedelta(days=31), today)]
    if args.seed_history:
        end = today - dt.timedelta(days=32)
        while (today - end).days < args.seed_history:
            windows.append((end - dt.timedelta(days=30), end))
            end = end - dt.timedelta(days=31)
    for start, end in windows:
        pr, cmr, rvr = fetch_window(c, tickers, start, end)
        merge_history(history, tickers, pr, cmr, rvr)
        print(f"history {start}..{end}: {len(pr)} price rows", file=sys.stderr)
    # compact: sorted arrays per ticker
    hist_out = {}
    for t, days in history.items():
        hist_out[t] = [dict(d=d, **v) for d, v in sorted(days.items())][-400:]
    write_json(hist_path, hist_out)
    # ---- featured detail (surface, cone, skew, chain)
    featured_ok = []
    if not args.no_featured:
        for t in FEATURED:
            try:
                surface = c.rows("/v1/impliedvol", ticker=t)
                cone = c.rows("/v1/volcone", ticker=t)
                chain = c.rows("/v1/optionchain", ticker=t)
            except ApiError as e:
                print(f"featured {t} skipped: {e}", file=sys.stderr)
                continue
            spot = None
            for row in surface:
                if row.get("spot_price"):
                    spot = row["spot_price"]
                    break
            trimmed = trim_chain(chain, spot)
            write_json(os.path.join(DATA, "featured", f"{t}.json"), {
                "ticker": t,
                "as_of": surface[0]["date"] if surface else None,
                "snapshot_at": surface[0].get("snapshot_at") if surface else None,
                "spot": spot,
                "surface": [{k: (r(v, 2) if isinstance(v, float) else v) for k, v in row.items() if k not in ("ticker", "snapshot_at")}
                            for row in surface if row.get("dte", 0) <= 420],
                "cone": [{k: (r(v, 3) if isinstance(v, float) else v) for k, v in row.items() if k not in ("ticker",)} for row in cone],
                "skew": [{k: (r(v, 4) if isinstance(v, float) else v) for k, v in row.items() if k not in ("ticker", "snapshot_at", "date")}
                         for row in skew.get(t, []) if row.get("maturity", 0) <= 420],
                "chain": trimmed,
            })
            featured_ok.append(t)

    # read back what is on disk so the manifest is honest even when a fetch was skipped
    on_disk = sorted(f[:-5] for f in os.listdir(os.path.join(DATA, "featured")) if f.endswith(".json"))

    write_json(os.path.join(DATA, "latest.json"), {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "as_of": as_of,
        "universe": universe,
        "featured": on_disk,
        "ideas": ideas_out,
        "api_calls": c.calls,
    })
    print(f"done: {len(universe)} tickers, featured={featured_ok}, api calls={c.calls} (~{2*c.calls} credits)", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except ApiError as e:
        sys.exit(f"Moontower API error: {e}")
