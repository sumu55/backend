"""ML model prediction service."""
import pickle
from pathlib import Path
from typing import Tuple, List


def _load_model():
    path = Path(__file__).parent.parent.parent / "ml_model" / "training" / "model.pkl"
    if not path.exists():
        return None
    try:
        with open(path, "rb") as f:
            return pickle.load(f)
    except Exception as e:
        print(f"[ML] WARNING: Could not load model.pkl ({e}). Using heuristic fallback.")
        print("[ML] Run: python ml_model/training/train_model.py  to retrain the model.")
        return None


def predict(temperature: float, humidity: float, blood_flow: float, motion: float) -> Tuple[int, str]:
    """Returns (prediction: 0=normal, 1=risk, insight_text)."""
    model_data = _load_model()
    if model_data is None:
        # Fallback heuristic when model not trained
        risk = 1 if (temperature > 37 or blood_flow < 70) else 0
        if risk:
            insight = "Temperature or blood flow may indicate risk. Consult a healthcare provider."
        else:
            insight = "Current readings appear normal. Keep monitoring."
        return risk, insight

    model = model_data["model"]
    scaler = model_data["scaler"]
    X = scaler.transform([[temperature, humidity, blood_flow, motion]])
    pred = int(model.predict(X)[0])
    insights = {
        0: "Your foot health parameters are within normal ranges. Continue regular monitoring.",
        1: "Risk condition detected. Elevated temperature or reduced blood flow may indicate early inflammation or poor circulation. Please consult your healthcare provider."
    }
    # Add dynamic insight based on features
    if pred == 1:
        if temperature > 37:
            insights[1] = f"Your foot temperature ({temperature}°C) has been elevated. This may indicate early inflammation. Consider rest and consultation."
        elif blood_flow < 75:
            insights[1] = f"Blood flow ({blood_flow}%) is below optimal. This may suggest circulation concerns. Stay hydrated and avoid prolonged standing."
    return pred, insights.get(pred, "Monitoring in progress.")


def get_trend_insight(history: List[dict]) -> str:
    """Generate insight from recent sensor history."""
    if len(history) < 3:
        return "Insufficient data for trend analysis. Keep wearing your smart shoes."
    temps = [h["temperature"] for h in history[-20:]]
    if len(temps) >= 5 and temps[-1] > temps[0] + 1:
        return f"Your foot temperature has been increasing for the last {min(20, len(temps))} readings. This may indicate early inflammation."
    blood = [h["blood_flow"] for h in history[-10:]]
    if len(blood) >= 3 and min(blood) < 70:
        return "Blood flow has dropped below optimal in recent readings. Consider elevating your feet."
    return "Parameters are stable. No significant trends detected."
