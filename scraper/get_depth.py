import sys
import json
import warnings
from datetime import datetime, timezone

import numpy as np

try:
    from bdshare import BDShareError, get_market_depth_data
except ImportError:
    from bdshare import BDShareError, get_market_depth_data

warnings.filterwarnings("ignore")

SOURCE = "bdshare"
FUNCTION = "get_market_depth_data"


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def emit_success(symbol, rows, warnings_list=None):
    payload = {
        "ok": True,
        "source": SOURCE,
        "function": FUNCTION,
        "fetchedAt": _iso_now(),
        "symbol": symbol,
        "rowCount": len(rows),
        "data": rows,
        "warnings": warnings_list or []
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_failure(symbol, error_type, error_message):
    payload = {
        "ok": False,
        "source": SOURCE,
        "function": FUNCTION,
        "fetchedAt": _iso_now(),
        "symbol": symbol,
        "errorType": error_type,
        "errorMessage": str(error_message)
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def sanitize_rows(rows):
    for row in rows:
        for key, value in row.items():
            if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
                row[key] = None
    return rows


def get_depth(symbol):
    try:
        df = get_market_depth_data(symbol)
        if df is None or df.empty:
            emit_failure(symbol, "BDShareError", "No depth data returned")
            return

        rows = sanitize_rows(df.to_dict(orient="records"))
        emit_success(symbol, rows)
    except BDShareError as error:
        emit_failure(symbol, "BDShareError", error)
    except Exception as error:
        emit_failure(symbol, "InternalError", error)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        emit_failure(None, "InternalError", "Usage: get_depth.py <symbol>")
        raise SystemExit(1)

    get_depth(sys.argv[1])
