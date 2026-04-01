import sys
import json
import warnings
from datetime import datetime, timezone

import numpy as np

try:
    from bdshare import BDShareError, get_basic_historical_data
except ImportError:
    from bdshare import BDShareError, get_basic_hist_data as get_basic_historical_data

warnings.filterwarnings("ignore")

SOURCE = "bdshare"
FUNCTION = "get_basic_historical_data"


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def emit_success(symbol, start_date, end_date, data, warnings_list=None):
    payload = {
        "ok": True,
        "source": SOURCE,
        "function": FUNCTION,
        "fetchedAt": _iso_now(),
        "symbol": symbol,
        "startDate": start_date,
        "endDate": end_date,
        "rowCount": len(data),
        "data": data,
        "warnings": warnings_list or []
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_failure(symbol, start_date, end_date, error_type, error_message):
    payload = {
        "ok": False,
        "source": SOURCE,
        "function": FUNCTION,
        "fetchedAt": _iso_now(),
        "symbol": symbol,
        "startDate": start_date,
        "endDate": end_date,
        "errorType": error_type,
        "errorMessage": str(error_message)
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def sanitize_rows(data):
    for row in data:
        for key, value in row.items():
            if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
                row[key] = None
    return data


def get_history(symbol, start_date, end_date):
    try:
        df = get_basic_historical_data(start_date, end_date, symbol)
        if df is None or df.empty:
            emit_failure(symbol, start_date, end_date, "BDShareError", "No historical data returned")
            return

        if hasattr(df, "index") and getattr(df.index, "name", None) is not None:
            df = df.reset_index()

        rows = sanitize_rows(df.to_dict(orient="records"))
        emit_success(symbol, start_date, end_date, rows)
    except BDShareError as error:
        emit_failure(symbol, start_date, end_date, "BDShareError", error)
    except Exception as error:
        emit_failure(symbol, start_date, end_date, "InternalError", error)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        emit_failure(None, None, None, "InternalError", "Usage: get_history.py <symbol> <start_date> <end_date>")
        raise SystemExit(1)

    get_history(sys.argv[1], sys.argv[2], sys.argv[3])
