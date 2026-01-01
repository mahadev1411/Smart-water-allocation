# Smart Water Allocation System using IoT, Machine Learning, and Blockchain

A decentralized, end-to-end smart irrigation system that uses **IoT sensors**, **machine learning models**, and **Hyperledger Fabric blockchain** to allocate and regulate water usage fairly and transparently for farmers.

This system ensures **tamper-proof water allocation**, **real-time monitoring**, and **automated enforcement of allocated volumes** at the field level.

---

## 🔍 Problem Statement

Traditional irrigation systems suffer from:
- Manual and unfair water distribution
- Overuse and wastage of water
- Lack of transparency and auditability
- No enforcement once water is allocated

This project addresses these issues by combining **IoT-based sensing**, **ML-driven allocation decisions**, and **blockchain-backed allocation records**.

---

## 🏗️ System Architecture

### High-level Flow

1. **IoT Node (ESP32)** collects environmental data  
   - Temperature  
   - Humidity  
   - Soil moisture  
   - Sunlight  
   - Flow meter readings  

2. Sensor data is published to **MQTT**
   
3. **Backend Server (Node.js)**:
- Consumes sensor data
- Fetches farmer profile from database
- Invokes ML models for:
  - Fertility estimation
  - Water allocation index
- Creates a **pending allocation**

4. **Admin Approval**:
- Base and additional allocations are approved via Admin Dashboard
- Approved allocations are:
  - Written to **Hyperledger Fabric**
  - Published to MQTT

5. **IoT Enforcement**:
- ESP32 receives allocation via MQTT
- Controls relay + flow sensor
- Automatically cuts water once allocated volume is consumed

---

## ⚙️ Technologies Used

### IoT & Communication
- ESP32
- MQTT (broker.emqx.io)
- Flow sensor, DHT11, Soil sensor, BH1750
- Relay-based valve control

### Backend
- Node.js (Express)
- Cassandra DB
- MQTT.js
- REST APIs

### Machine Learning
- Python (Flask)
- Scikit-learn
- Joblib
- Models:
- Fertility prediction
- Water allocation index (0–100 scale)

### Blockchain
- Hyperledger Fabric
- Fabric Gateway SDK
- Chaincode (Smart Contracts)
- Immutable allocation ledger

---

## 🔐 Blockchain Usage (Hyperledger Fabric)

Each **approved allocation** (base or additional) is recorded on-chain with:
- Allocation ID
- Farmer ID
- Allocated volume
- Timestamp
- Transaction hash

### Why Blockchain?
- Prevents manipulation of water allocation
- Enables auditability
- Ensures trust between authorities and farmers



