"""Sensor data simulator - generates realistic random sensor data."""
import random
from datetime import datetime, timedelta
from typing import Dict, Any


def generate_simulated_data(base: Dict[str, float] = None) -> Dict[str, Any]:
    """Generate realistic random sensor data for diabetic foot monitoring.
    
    Ranges based on typical sensor outputs:
    - MAX30100 blood flow: 0-100 (SpO2-like normalized)
    - ADXL345 motion: 0-1 (g force normalized)
    - DHT temp: 20-40°C, humidity: 30-90%
    """
    if base:
        # Slight variation around base for continuity
        temp = base.get("temperature", 32) + random.uniform(-1.5, 1.5)
        humidity = base.get("humidity", 65) + random.uniform(-5, 5)
        blood_flow = base.get("blood_flow", 85) + random.uniform(-8, 8)
        motion = base.get("motion", 0.4) + random.uniform(-0.15, 0.15)
    else:
        temp = random.uniform(28, 36)
        humidity = random.uniform(40, 80)
        blood_flow = random.uniform(70, 98)
        motion = random.uniform(0.1, 0.8)

    # Clamp to realistic ranges
    temp = max(20, min(45, round(temp, 1)))
    humidity = max(20, min(99, round(humidity, 1)))
    blood_flow = max(50, min(100, round(blood_flow, 1)))
    motion = max(0, min(1, round(motion, 2)))

    return {
        "temperature": temp,
        "humidity": humidity,
        "blood_flow": blood_flow,
        "motion": motion,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
