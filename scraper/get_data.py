import sys
import json
import warnings
from datetime import datetime, timezone
import numpy as np
from bdshare import BDShareError, get_current_trade_data

# Senior Move: Suppress all warnings so they don't pollute our JSON output
warnings.filterwarnings("ignore")

SOURCE = "bdshare"
FUNCTION = "get_current_trade_data"


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def emit_success(data, warnings_list=None):
    payload = {
        "ok": True,
        "source": SOURCE,
        "function": FUNCTION,
        "fetchedAt": _iso_now(),
        "rowCount": len(data),
        "data": data,
        "warnings": warnings_list or []
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_failure(error_type, error_message):
    payload = {
        "ok": False,
        "source": SOURCE,
        "function": FUNCTION,
        "fetchedAt": _iso_now(),
        "errorType": error_type,
        "errorMessage": str(error_message)
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def get_live_data():
    try:
        df = get_current_trade_data()
        
        if df is None or df.empty:
            emit_failure("BDShareError", "DSE returned no data")
            return

        # Convert to list of dicts
        data = df.to_dict(orient='records')
        
        # Replace NaN and Infinity with None (null in JSON)
        for row in data:
            for key, value in row.items():
                if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
                    row[key] = None
        
        # Debugging: Log the number of rows and the size of the JSON output
        sys.stderr.write(f"DEBUG: Retrieved {len(data)} rows\n")
        json_output = json.dumps(data, ensure_ascii=False)
        sys.stderr.write(f"DEBUG: JSON output size: {len(json_output)} bytes\n")

        emit_success(data)

    except BDShareError as e:
        emit_failure("BDShareError", e)
    except Exception as e:
        emit_failure("InternalError", e)

if __name__ == "__main__":
    get_live_data()