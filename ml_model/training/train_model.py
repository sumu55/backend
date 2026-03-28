"""Train a simple ML model for foot health risk prediction."""
import numpy as np
import pickle
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Simulated training data: (temp, humidity, blood_flow, motion) -> 0=normal, 1=risk
# Risk conditions: high temp, low blood flow, abnormal motion patterns
np.random.seed(42)

def generate_training_data(n_samples=1000):
    X = []
    y = []
    for _ in range(n_samples):
        temp = np.random.uniform(25, 42)
        humidity = np.random.uniform(30, 95)
        blood_flow = np.random.uniform(50, 100)
        motion = np.random.uniform(0, 1)
        # Risk: high temp (>37), low blood flow (<75), or both
        risk = 1 if (temp > 37 or blood_flow < 70 or (temp > 35 and blood_flow < 80)) else 0
        if np.random.random() < 0.1:  # Add noise
            risk = 1 - risk
        X.append([temp, humidity, blood_flow, motion])
        y.append(risk)
    return np.array(X), np.array(y)

def train():
    X, y = generate_training_data(2000)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    model = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
    model.fit(X_train_scaled, y_train)
    acc = model.score(X_test_scaled, y_test)
    print(f"Model accuracy: {acc:.2%}")
    path = Path(__file__).parent
    with open(path / "model.pkl", "wb") as f:
        pickle.dump({"model": model, "scaler": scaler}, f)
    print("Model saved to model.pkl")

if __name__ == "__main__":
    train()
