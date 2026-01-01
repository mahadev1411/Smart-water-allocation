const axios = require("axios");
const express = require("express");
const mqtt = require("mqtt");
const { ethers } = require("ethers");
const cors = require("cors");

// -----------------------------
// Ethereum / Hardhat setup
// -----------------------------
const RPC_URL = "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// paste authority private key from hardhat node terminal
const AUTHORITY_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const client = require("./cassandra");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "water_secret_key"; // later put in .env


const app = express();
app.use(cors());
const port = 3000;
app.use(express.json());

const CONTRACT_ABI = [
  "function createWaterAllocation(string id, string farmerID, uint256 allocatedVolume, uint256 timestamp)",
  "function queryAllocation(string id) view returns (string,string,uint256,uint256,uint256,address)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const authoritySigner = new ethers.Wallet(AUTHORITY_PRIVATE_KEY, provider);
const waterContract = new ethers.Contract(
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  authoritySigner
);

// -----------------------------
// MQTT Setup
// -----------------------------
const brokerUrl = "mqtt://broker.emqx.io:1883";
const SENSOR_TOPIC = "water/sensor/data";
const ALLOC_TOPIC = "water/allocation/commands";
const mqttClient = mqtt.connect(brokerUrl);

// -----------------------------
// Live Sensor + ML storage
// -----------------------------
const liveSensors = [];      // last 5 sensor packets
let lastMLDecision = null;   // latest ML decision output

// -----------------------------
// Allocation storage
// -----------------------------
const pendingAllocations = new Map();
const approvedAllocations = new Map();

// -----------------------------
// ML model call
// -----------------------------
async function runMLAllocation(sensorJson) {
  const resp = await axios.post("http://127.0.0.1:5000/predict", sensorJson);
  const { fertility_score, allocatedVolume } = resp.data;

  console.log(
    "🧠 Fertility score:",
    fertility_score,
    "→ AllocatedVolume:",
    allocatedVolume
  );

  return {
    farmerId: sensorJson.farmerId || "FARMER_UNKNOWN",
    zone: sensorJson.location,
    fertility_score,
    allocatedVolume,
    period: "DAY",
    validForMinutes: 60,
    decisionTimestamp: Date.now(),
  };
}

// -----------------------------
// MQTT connect + subscribe
// -----------------------------
mqttClient.on("connect", () => {
  console.log("✅ MQTT connected");
  mqttClient.subscribe(SENSOR_TOPIC, (err) => {
    if (err) console.error("Subscribe error:", err);
    else console.log("📥 Subscribed to", SENSOR_TOPIC);
  });
});

// -----------------------------
// MQTT message handler
// -----------------------------
mqttClient.on("message", async (topic, message) => {
  if (topic !== SENSOR_TOPIC) return;

  try {
    const sensorData = JSON.parse(message.toString());
    console.log("📡 Sensor data received:", sensorData);

    // store last 5 packets for UI
    liveSensors.unshift({
      zone: sensorData.location,
      farmerId: sensorData.farmerId,
      temperature: sensorData.temperature,
      humidity: sensorData.humidity,
      ph: sensorData.ph,
      rainfall: sensorData.rainfall,
      flowRate: sensorData.flowRate ?? null,
      receivedAt: Date.now(),
    });
    if (liveSensors.length > 5) liveSensors.pop();

    // ML decision
    const allocation = await runMLAllocation(sensorData);

    // store latest ML decision for UI
    lastMLDecision = {
      zone: allocation.zone,
      farmerId: allocation.farmerId,
      fertility_score: allocation.fertility_score,
      allocatedVolume: allocation.allocatedVolume,
      period: allocation.period,
      decisionTimestamp: allocation.decisionTimestamp,
    };

    // create allocation record
    const allocationId = `AL_${Date.now()}`;

    const pendingRecord = {
      allocationId,
      farmerId: allocation.farmerId,
      zone: allocation.zone,
      fertility_score: allocation.fertility_score,
      allocatedVolume: allocation.allocatedVolume,
      period: allocation.period,
      decisionTimestamp: allocation.decisionTimestamp,
      status: "PENDING",
    };

    pendingAllocations.set(allocationId, pendingRecord);

    console.log("🕒 Pending allocation created:", pendingRecord);

    // publish allocation decision back to IoT controller
    mqttClient.publish(ALLOC_TOPIC, JSON.stringify(allocation));
    console.log("📤 Published allocation to", ALLOC_TOPIC);

  } catch (e) {
    console.error("Invalid sensor JSON:", e.message);
  }
});

// -----------------------------
// REST APIs
// -----------------------------

// Live sensors for UI
app.get("/api/sensors/live", (req, res) => {
  res.json(liveSensors);
});

// Latest ML decision for UI
app.get("/api/ml/decision", (req, res) => {
  res.json(lastMLDecision || {});
});

// pending list
app.get("/api/admin/pendingAllocations", (req, res) => {
  res.json(Array.from(pendingAllocations.values()));
});

// approve + push to chain
app.post("/api/admin/approveAllocation/:allocationId", async (req, res) => {
  try {
    const { allocationId } = req.params;
    const pending = pendingAllocations.get(allocationId);

    if (!pending || pending.status !== "PENDING") {
      return res.status(404).json({ error: "Pending allocation not found" });
    }

    pending.status = "APPROVED";
    pending.approvedBy = "admin";
    pending.approvedAt = Date.now();

    const tx = await waterContract.createWaterAllocation(
      pending.allocationId,
      pending.farmerId,
      pending.allocatedVolume,
      Math.floor(pending.decisionTimestamp / 1000)
    );

    const receipt = await tx.wait();
    pending.txHash = receipt.hash;

    console.log("⛓️ Stored on Ethereum:", pending);
    console.log("Tx:", receipt.hash);

    approvedAllocations.set(allocationId, pending);
    pendingAllocations.delete(allocationId);

    res.json({
      status: "APPROVED",
      allocationId,
      txHash: receipt.hash,
    });
  } catch (e) {
    console.error("Approve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// reject
app.post("/api/admin/rejectAllocation/:allocationId", (req, res) => {
  const { allocationId } = req.params;
  const pending = pendingAllocations.get(allocationId);

  if (!pending || pending.status !== "PENDING") {
    return res.status(404).json({ error: "Pending allocation not found" });
  }

  pending.status = "REJECTED";
  pending.rejectedBy = "admin";
  pending.rejectedAt = Date.now();

  pendingAllocations.set(allocationId, pending);

  console.log("❌ Allocation rejected:", pending);

  res.json({ status: "REJECTED", allocationId });
});

// approved list
app.get("/api/allocations", (req, res) => {
  res.json(Array.from(approvedAllocations.values()));
});

// ✅ Farmer-specific allocations (pending + approved)
app.get("/api/farmer/:farmerId/allocations", (req, res) => {
  const farmerId = req.params.farmerId;

  const pending = Array.from(pendingAllocations.values())
    .filter(a => a.farmerId === farmerId);

  const approved = Array.from(approvedAllocations.values())
    .filter(a => a.farmerId === farmerId);

  res.json({ pending, approved });
});


// blockchain query (+ include txHash if known)
app.get("/api/query/:id", async (req, res) => {
  try {
    const allocationId = req.params.id;
    console.log(`🔍 Query request for ID: ${allocationId}`);

    const allocation = await waterContract.queryAllocation(allocationId);

    const localApproved = approvedAllocations.get(allocationId);

    const response = {
      ID: allocation[0],
      farmerID: allocation[1],
      allocatedVolume: allocation[2].toString(),
      usedVolume: allocation[3].toString(),
      timestamp: allocation[4].toString(),
      issuingAuthority: allocation[5],
      txHash: localApproved?.txHash || null
    };

    res.json(response);
  } catch (error) {
    console.error("Query error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Proof panel endpoint
app.get("/api/proof", async (req, res) => {
  try {
    const currentBlockNumber = await provider.getBlockNumber();
    const recentTxHashes = Array.from(approvedAllocations.values())
      .slice(-5)
      .map((x) => x.txHash)
      .filter(Boolean)
      .reverse();

    res.json({
      contractAddress: CONTRACT_ADDRESS,
      currentBlockNumber,
      recentTxHashes,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Get all blocks (simple demo)
app.get("/api/blocks", async (req, res) => {
  try {
    const currentBlockNumber = await provider.getBlockNumber();
    const blocks = [];

    for (let i = 0; i <= currentBlockNumber; i++) {
      const b = await provider.getBlock(i);
      blocks.push({
        number: b.number,
        hash: b.hash,
        timestamp: b.timestamp,
        txCount: b.transactions.length
      });
    }

    res.json({ currentBlockNumber, blocks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/farmer/register", async (req, res) => {
  try {
    const { farmerId, name, phone, email, password, zone } = req.body;

    if (!farmerId || !phone || !password) {
      return res.status(400).json({ error: "farmerId, phone, password required" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // insert main record
    await client.execute(
      `INSERT INTO farmers (farmer_id, name, phone, email, password_hash, zone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, toTimestamp(now()))`,
      [farmerId, name, phone, email, passwordHash, zone],
      { prepare: true }
    );

    // insert lookup record
    await client.execute(
      `INSERT INTO farmers_by_phone (phone, farmer_id, name, zone)
       VALUES (?, ?, ?, ?)`,
      [phone, farmerId, name, zone],
      { prepare: true }
    );

    res.json({ status: "REGISTERED", farmerId });
  } catch (e) {
    console.error("Register error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/farmer/login", async (req, res) => {
  try {
    const { farmerId, password } = req.body;

    const result = await client.execute(
      `SELECT password_hash, name, zone FROM farmers WHERE farmer_id=?`,
      [farmerId],
      { prepare: true }
    );

    if (result.rowLength === 0) {
      return res.status(404).json({ error: "Farmer not found" });
    }

    const farmer = result.first();
    const ok = await bcrypt.compare(password, farmer.password_hash);

    if (!ok) return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ farmerId }, JWT_SECRET, { expiresIn: "1d" });

    res.json({
      status: "LOGGED_IN",
      token,
      farmerId,
      name: farmer.name,
      zone: farmer.zone,
    });
  } catch (e) {
    console.error("Login error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

function authFarmer(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.farmerId = decoded.farmerId;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/api/farmer/me", authFarmer, async (req, res) => {
  try {
    const farmerId = req.farmerId;

    const result = await client.execute(
      `SELECT farmer_id, name, phone, email, zone, created_at 
       FROM farmers WHERE farmer_id=?`,
      [farmerId],
      { prepare: true }
    );

    if (result.rowLength === 0) {
      return res.status(404).json({ error: "Farmer not found" });
    }

    res.json(result.first());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.get("/api/farmer/allocations", authFarmer, (req, res) => {
  const farmerId = req.farmerId;

  const allocations = Array.from(approvedAllocations.values())
    .filter((a) => a.farmerId === farmerId);

  res.json(allocations);
});

// health
app.get("/api/status", (req, res) => {
  res.json({ status: "Server is running" });
});

app.listen(port, () => {
  console.log(`🚀 Backend running at http://localhost:${port}`);
});
