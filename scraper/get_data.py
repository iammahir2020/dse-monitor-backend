import sys
import json
import warnings
import numpy as np
from bdshare import get_current_trade_data

# Senior Move: Suppress all warnings so they don't pollute our JSON output
warnings.filterwarnings("ignore")

def get_live_data():
    try:
        df = get_current_trade_data()
        
        if df is None or df.empty:
            print(json.dumps({"error": "DSE returned no data"}))
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
        
        # Output JSON with ensure_ascii=False and add a newline
        sys.stdout.write(json_output + '\n')
        sys.stdout.flush()
        
    except Exception as e:
        sys.stdout.write(json.dumps({"error": str(e)}) + '\n')
        sys.stdout.flush()

if __name__ == "__main__":
    get_live_data()