require("dotenv").config();

const axios = require("axios");
const admin = require("firebase-admin");
const express = require("express");

const app = express();
app.use(express.json());

// ================= ROOT ROUTE (FIX 404) =================
app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

// ================= FIREBASE =================
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
  databaseURL: process.env.DATABASE_URL
});

const db = admin.database();

// ================= API KEYS =================
const ORS_KEY = process.env.ORS_API_KEY;

// =====================================================
// 🎤 VOICE FUNCTION
// =====================================================
async function processVoice() {
  try {
    const ref = db.ref("voice");
    const snap = await ref.once("value");
    const data = snap.val();

    if (!data || !data.request) return;

    console.log("🎤 Voice request received");

    const text = "test command"; // temporary

    await ref.update({
      status: "done",
      result: text,
      request: false
    });

    console.log("🗣️ Voice processed:", text);

  } catch (err) {
    console.log("❌ Voice Error:", err.message);

    await db.ref("voice").update({
      status: "failed",
      request: false
    });
  }
}

// =====================================================
// 🧭 NAVIGATION FUNCTION
// =====================================================
async function updateNavigation() {
  try {
    const snap = await db.ref("navigation_device").once("value");
    const data = snap.val();

    if (!data || !data.location || !data.destination) {
      console.log("No data yet...");
      return;
    }

    if (
      data.location.lat === 0 ||
      data.location.lon === 0 ||
      data.destination.lat === 0 ||
      data.destination.lon === 0
    ) {
      console.log("Waiting for valid GPS...");
      return;
    }

    const start = [data.location.lon, data.location.lat];
    const end = [data.destination.lon, data.destination.lat];

    console.log("START:", start);
    console.log("END:", end);

    const res = await axios.post(
      "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
      {
        coordinates: [start, end]
      },
      {
        headers: {
          Authorization: ORS_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const step = res.data.features[0].properties.segments[0].steps[0];

    let instruction = step.instruction.toLowerCase();

    if (instruction.includes("left")) instruction = "LEFT";
    else if (instruction.includes("right")) instruction = "RIGHT";
    else instruction = "STRAIGHT";

    let distance = Math.round(step.distance);

    if (distance <= 10) distance = 10;
    else if (distance <= 20) distance = 20;
    else if (distance <= 50) distance = 50;
    else if (distance <= 100) distance = 100;
    else if (distance <= 200) distance = 200;
    else if (distance <= 500) distance = 500;
    else distance = 1000;

    console.log("➡", instruction, distance);

    await db.ref("navigation_device").update({
      instruction,
      distance
    });

  } catch (err) {
    console.log("❌ ORS ERROR:", err.message);
  }
}

// =====================================================
// 🚀 SERVER START (ONLY ONCE)
// =====================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

// =====================================================
// 🔁 LOOPS
// =====================================================
setInterval(processVoice, 3000);
setInterval(updateNavigation, 5000);