const axios = require("axios");
const express = require("express");
const mqtt = require("mqtt");
const cors = require("cors");

const client = require("./cassandra");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const fabric = require("./fabricClient"); // ✅ Fabric client

const JWT_SECRET = "water_secret_key";

// -----------------------------
// Express Setup
// -----------------------------
const app = express();
app.use(cors());
const port = 3000;
app.use(express.json());

// -----------------------------
// MQTT Setup
// -----------------------------
const brokerUrl = "mqtt://10.223.141.250:1883";
const SENSOR_TOPIC_WILDCARD = "farmer/+/sensor/data";   // ✅ new path
const mqttClient = mqtt.connect(brokerUrl);

// ✅ Replace these with the exact encoding used in training (only for soil numeric)
const CROP_TYPE_MAP = {
  rice: "rice",
  wheat: "wheat",
  maize: "maize",
  sugarcane: "sugarcane",
};

const SOIL_TYPE_MAP = {
  clay: 1,
  loam: 2,
  sandy: 3,
  silt: 4,
};

// -----------------------------
// Live Sensor + ML storage
// -----------------------------
const liveSensors = [];
let lastMLDecision = null;

// -----------------------------
// Allocation storage
// -----------------------------
const pendingAllocations = new Map();
const approvedAllocations = new Map();
// Additional allocation requests
const pendingAdditionalAllocations = new Map();   // key: addReqId


// -----------------------------
// Helper: fetch farmer fixed params from Cassandra
// -----------------------------
async function getFarmerParams(farmerId) {
  try {
    const result = await client.execute(
      `SELECT land_size, crop_type, ph, soil_type, zone, name
       FROM farmers WHERE farmer_id=?`,
      [farmerId],
      { prepare: true }
    );

    if (result.rowLength === 0) return null;
    return result.first();
  } catch (e) {
    console.error("Farmer fetch error:", e.message);
    return null;
  }
}

// -----------------------------
// ML Calls
// -----------------------------
async function runFertilityModel(features) {
  const resp = await axios.post("http://127.0.0.1:5000/predict", features);
  return resp.data; // { fertility_score }
}

async function runAllocationIndexModel(features) {
  const resp = await axios.post("http://127.0.0.1:5001/predict", features);
  return resp.data; // { allocation_index }
}

// -----------------------------
// MQTT connect + subscribe
// -----------------------------
mqttClient.on("connect", () => {
  console.log("✅ MQTT connected");
  mqttClient.subscribe(SENSOR_TOPIC_WILDCARD, (err) => {
    if (err) console.error("Subscribe error:", err);
    else console.log("📥 Subscribed to", SENSOR_TOPIC_WILDCARD);
  });
});

// -----------------------------
// MQTT message handler
// -----------------------------
mqttClient.on("message", async (topic, message) => {
  // Expect: farmer/<farmerId>/sensor/data
  const parts = topic.split("/");
  if (parts.length !== 4 || parts[0] !== "farmer" || parts[2] !== "sensor") {
    return; // ignore other topics
  }

  const farmerIdFromTopic = parts[1];

  try {
    const sensorData = JSON.parse(message.toString());
    console.log("📡 Sensor data received:", farmerIdFromTopic, sensorData);

    const farmerId = farmerIdFromTopic;

    // ✅ Fetch farmer fixed params (from registration)
    const farmerParams = await getFarmerParams(farmerId);

    // ✅ If farmer not registered → ignore packet safely
    if (!farmerParams) {
      console.warn(`⚠️ Farmer ${farmerId} not found in DB. Ignoring this sensor packet.`);
      return;
    }

    // ✅ zone from DB
    const zoneFromDB = farmerParams.zone || "ZONE_UNKNOWN";

    const cropTypeRaw = (farmerParams.crop_type || "").toLowerCase();
    const soilTypeRaw = (farmerParams.soil_type || "").toLowerCase();

    const label_for_model2 = CROP_TYPE_MAP[cropTypeRaw] ?? "UNKNOWN"; // ✅ string label
    const soil_type_code = SOIL_TYPE_MAP[soilTypeRaw] ?? 0;          // ✅ numeric soil

    // ✅ Store last 5 sensor packets (for UI)
    liveSensors.unshift({
      zone: zoneFromDB,
      farmerId,
      temperature: sensorData.temperature ?? 0,
      humidity: sensorData.humidity ?? 0,
      soil_moisture: sensorData.soil_moisture ?? 0,
      sunlight: sensorData.sunlight ?? 0,
      receivedAt: Date.now(),
    });
    if (liveSensors.length > 5) liveSensors.pop();

    // ---- payload only for fertility model (Model 1)
    const fertilityPayload = {
      temperature: sensorData.temperature ?? 0,
      humidity: sensorData.humidity ?? 0,
      ph: farmerParams.ph ?? 0,
      rainfall: 20,           // hardcoded for now
      soil_moisture: sensorData.soil_moisture ?? 0,
      fertilizer_usage: 3,    // hardcoded for now
    };

    // ---- payload only for allocation index model (Model 2)
    const allocationPayload = {
      humidity: sensorData.humidity ?? 0,
      soil_moisture: sensorData.soil_moisture ?? 0,
      temperature: sensorData.temperature ?? 0,
      sunlight_exposure: sensorData.sunlight ?? 0,  // ✅ correct name
      land_area: farmerParams.land_size ?? 0,       // ✅ correct name
      label: label_for_model2,                      // ✅ crop string
      ph: farmerParams.ph ?? 0,
      soil_type: soil_type_code,                    // ✅ numeric
    };

    // ✅ Call models separately
    const fertOut = await runFertilityModel(fertilityPayload);
    const fertility_score = fertOut.fertility_score ?? 0;
    //const fertility_score = 0.75;
    const idxOut = await runAllocationIndexModel(allocationPayload);
    const allocation_index = idxOut.allocation_index ?? 0;

    // ✅ Final allocated volume
    const finalAllocatedVolume =
      (farmerParams.land_size ?? 0) * allocation_index;

    // Save latest ML decision for Admin UI
    lastMLDecision = {
      zone: zoneFromDB,
      farmerId,
      fertility_score,
      allocation_index,
      land_size: farmerParams.land_size ?? 0,
      allocatedVolume: finalAllocatedVolume,
      period: "DAY",
      decisionTimestamp: Date.now(),
    };

    // create allocation record
    const allocationId = `AL_${Date.now()}`;

    const pendingRecord = {
      allocationId,
      farmerId,
      zone: zoneFromDB,
      fertility_score,
      allocation_index,
      land_size: farmerParams.land_size ?? 0,
      allocatedVolume: finalAllocatedVolume,
      period: "DAY",
      decisionTimestamp: Date.now(),
      status: "PENDING",
    };

    pendingAllocations.set(allocationId, pendingRecord);
    console.log("🕒 Pending allocation created:", pendingRecord);

    // ✅ publish to farmer/<id>/allocation
    const allocTopic = `farmer/${farmerId}/allocation`;
    mqttClient.publish(
      allocTopic,
      JSON.stringify({
        farmerId,
        zone: zoneFromDB,
        fertility_score,
        allocation_index,
        allocatedVolume: finalAllocatedVolume,
        period: "DAY",
      })
    );

    console.log("📤 Published allocation to", allocTopic);

  } catch (e) {
    console.error("Invalid sensor JSON:", e.message);
  }
});

// -----------------------------
// REST APIs
// -----------------------------
app.get("/api/sensors/live", (req, res) => {
  res.json(liveSensors);
});

app.get("/api/ml/decision", (req, res) => {
  res.json(lastMLDecision || {});
});

app.get("/api/admin/pendingAllocations", (req, res) => {
  res.json(Array.from(pendingAllocations.values()));
});

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

    // ✅ Fabric on-chain write
    const result = await fabric.createWaterAllocation({
      id: pending.allocationId,
      farmerId: pending.farmerId,
      allocatedVolume: Math.floor(pending.allocatedVolume),
      timestamp: Math.floor(pending.decisionTimestamp / 1000),
    });
    console.log('tx ID',result.txId);
    pending.txHash = result.txId;
    mqttClient.publish(
  `farmer/${pending.farmerId}/allocation`,
  JSON.stringify({
    farmerId: pending.farmerId,
    allocatedVolume: Math.floor(pending.allocatedVolume),
    timestamp: Date.now()
  })
);


    approvedAllocations.set(allocationId, pending);
    pendingAllocations.delete(allocationId);

    res.json({
      status: "APPROVED",
      allocationId,
      txId: pending.txId,
    });

  } catch (e) {
    console.error("Approve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

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
  res.json({ status: "REJECTED", allocationId });
});

app.get("/api/allocations", (req, res) => {
  res.json(Array.from(approvedAllocations.values()));
});

// Optional proof endpoint (Fabric-friendly)
app.get("/api/proof", async (req, res) => {
  try {
    const proof = await fabric.getProofSnapshot();
    res.json(proof);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});
function generateFarmerId(zone) {
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `FARMER_${zone}_${suffix}`;
}
// -----------------------------
// Farmer Auth + Cassandra routes
// -----------------------------
app.post("/api/farmer/register", async (req, res) => {
  try {
    const {
       name, phone, email, password, zone,
      land_size, crop_type, ph, soil_type
    } = req.body;

     const farmerId = generateFarmerId(zone);

    if (!zone || !phone || !password) {
      return res.status(400).json({ error: "zone, phone, password required" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await client.execute(
      `INSERT INTO farmers (
        farmer_id, name, phone, email, password_hash, zone,
        land_size, crop_type, ph, soil_type,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, toTimestamp(now()))`,
      [
        farmerId, name, phone, email, passwordHash, zone,
        land_size ?? 0, crop_type ?? "UNKNOWN", ph ?? 0, soil_type ?? "UNKNOWN"
      ],
      { prepare: true }
    );

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
      `SELECT farmer_id, name, phone, email, zone, land_size, crop_type, ph, soil_type, created_at
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

// Farmer requests additional water for an already-approved allocation
app.post("/api/farmer/requestAdditional/:allocationId", authFarmer, (req, res) => {
  const farmerId = req.farmerId;
  const { allocationId } = req.params;
  const { requestedVolume } = req.body;

  if (!requestedVolume || requestedVolume <= 0) {
    return res.status(400).json({ error: "requestedVolume must be > 0" });
  }

  const approved = approvedAllocations.get(allocationId);
  if (!approved) {
    return res.status(404).json({ error: "Approved allocation not found" });
  }

  // farmer can only request extra for their own allocation
  if (approved.farmerId !== farmerId) {
    return res.status(403).json({ error: "Not allowed" });
  }

  const addReqId = `ADD_${Date.now()}`;

  const reqRecord = {
    addReqId,
    allocationId,
    farmerId,
    zone: approved.zone,
    baseAllocatedVolume: approved.allocatedVolume,
    requestedVolume,
    status: "PENDING",
    requestedAt: Date.now(),
  };

  pendingAdditionalAllocations.set(addReqId, reqRecord);

  res.json({ status: "ADDITIONAL_REQUESTED", addReqId });
});


app.get("/api/admin/pendingAdditionalAllocations", (req, res) => {
  res.json(Array.from(pendingAdditionalAllocations.values()));
});

app.post("/api/admin/approveAdditional/:addReqId", async (req, res) => {
  try {
    const { addReqId } = req.params;
    const pendingAdd = pendingAdditionalAllocations.get(addReqId);

    if (!pendingAdd || pendingAdd.status !== "PENDING") {
      return res.status(404).json({ error: "Pending additional request not found" });
    }

    const approved = approvedAllocations.get(pendingAdd.allocationId);
    if (!approved) {
      return res.status(404).json({ error: "Base approved allocation not found" });
    }

    // 1) push additional allocation ON-CHAIN (Fabric)
    // 1) push additional allocation ON-CHAIN (Fabric)
const result = await fabric.addAdditionalAllocation({
  baseId: approved.allocationId,
  additionalVolume: Math.floor(pendingAdd.requestedVolume),
  timestamp: Math.floor(Date.now() / 1000),
});
const addTxId = result.txId;

// 2) update totals for UI
const prevExtra = approved.additionalApprovedVolume ?? 0;
const newExtra = prevExtra + pendingAdd.requestedVolume;

approved.additionalApprovedVolume = newExtra;
approved.totalAllocatedVolume = approved.allocatedVolume + newExtra;
approved.lastAdditionalTxHash = addTxId;

// 3) mark request approved
pendingAdd.status = "APPROVED";
pendingAdd.approvedBy = "admin";
pendingAdd.approvedAt = Date.now();
pendingAdd.txId = addTxId;

pendingAdditionalAllocations.delete(addReqId);

// 4) ✅ PUBLISH ONLY THE ADDITIONAL VOLUME (timestamped)
const allocTopic = `farmer/${approved.farmerId}/allocation`;
mqttClient.publish(
  allocTopic,
  JSON.stringify({
    farmerId: approved.farmerId,
    allocatedVolume: Math.floor(pendingAdd.requestedVolume), // ✅ ONLY additional
    timestamp: Date.now(),                                   // ✅ REQUIRED
    isAdditional: true
  })
);

// 5) response
res.json({
  status: "APPROVED",
  addReqId,
  allocationId: approved.allocationId,
  additionalTxId: addTxId,
  totalAllocatedVolume: approved.totalAllocatedVolume
});

  } catch (e) {
    console.error("Approve additional error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/rejectAdditional/:addReqId", (req, res) => {
  const { addReqId } = req.params;
  const pendingAdd = pendingAdditionalAllocations.get(addReqId);

  if (!pendingAdd || pendingAdd.status !== "PENDING") {
    return res.status(404).json({ error: "Pending additional request not found" });
  }

  pendingAdd.status = "REJECTED";
  pendingAdd.rejectedBy = "admin";
  pendingAdd.rejectedAt = Date.now();

  // keep record if you want history, or delete:
  pendingAdditionalAllocations.set(addReqId, pendingAdd);

  res.json({ status: "REJECTED", addReqId });
});

// health
app.get("/api/status", (req, res) => {
  res.json({ status: "Server is running" });
});

// 🔹 TEST route to verify Fabric write
app.post("/api/test/fabric", async (req, res) => {
  try {
    const result = await fabric.createWaterAllocation({
      id: "TEST_" + Date.now(),
      farmerId: "FARMER_TEST",
      allocatedVolume: 100,
      timestamp: Math.floor(Date.now() / 1000),
    });

    res.json({
      ok: true,
      txId: result.txId,
    });
  } catch (e) {
    console.error("Fabric test error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


app.listen(port, () => {
  console.log(`🚀 Backend running at http://localhost:${port}`);
});