# allocation_app.py (FIXED)
from flask import Flask, request, jsonify
import joblib, pandas as pd, os

app = Flask(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "final_water_model.joblib")
model = joblib.load(MODEL_PATH)

# MUST match training columns
CANDIDATE_FEATURES = [
    "humidity",
    "soil_moisture",
    "temperature",
    "sunlight_exposure",
    "land_area",
    "label",
    "ph",
    "soil_type"
]


@app.post("/predict")
def predict_index():
    data = request.get_json(force=True)

    row = {
        "humidity": float(data.get("humidity", 0)),
        "soil_moisture": float(data.get("soil_moisture", 0)),
        "temperature": float(data.get("temperature", 0)),
        "sunlight_exposure": float(data.get("sunlight_exposure", 0)),
        "land_area": float(data.get("land_area", 0)),
        "ph": float(data.get("ph", 0)),

        # ✅ label is categorical in training
        "label": str(data.get("label", "UNKNOWN")),

        # ✅ soil_type is numeric in training
        "soil_type": float(data.get("soil_type", 0)),
    }

    X = pd.DataFrame([row])
    allocation_index = float(model.predict(X)[0])

    return jsonify({"allocation_index": allocation_index})



if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
