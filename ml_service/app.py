from flask import Flask, request, jsonify
import joblib
import pandas as pd
import os

app = Flask(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "fertility_model.joblib")
model = joblib.load(MODEL_PATH)

CANDIDATE_FEATURES = ["temperature", "humidity", "ph", "rainfall", "soil_moisture", "fertilizer_usage"]

@app.post("/predict")
def predict():
    data = request.get_json(force=True)

    row = {f: float(data.get(f, 0)) for f in CANDIDATE_FEATURES}
    X = pd.DataFrame([row])

    fertility_score = float(model.predict(X)[0])

    return jsonify({
        "fertility_score": fertility_score
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
