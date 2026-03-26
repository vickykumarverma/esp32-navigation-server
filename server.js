require("dotenv").config();

const axios = require("axios");
const admin = require("firebase-admin");
const express = require("express");

const app = express();
app.use(express.json());

// ================= ROOT ROUTE =================
app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

// ================= FIREBASE =================
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
  databaseURL: process.env.DATABASE_URL
});

const db = admin.database();

// ================= API KEY =================
const ORS_KEY = process.env.ORS_API_KEY;

// ================= GLOBAL STATE =================
let lastLocation = null;
let lastCallTime = 0;
let lastDestination = null;

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

    const text = "test command";

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

    const { lat, lon } = data.location;
    const { lat: dlat, lon: dlon } = data.destination;

    // Validate GPS
    if (lat === 0 || lon === 0 || dlat === 0 || dlon === 0) {
      console.log("Waiting for valid GPS...");
      return;
    }

    const currentLocation = [lon, lat];
    const currentDestination = [dlon, dlat];

    // ================= DESTINATION CHANGE =================
    let destinationChanged = false;

    if (
      !lastDestination ||
      currentDestination[0] !== lastDestination[0] ||
      currentDestination[1] !== lastDestination[1]
    ) {
      console.log("📍 New destination → forcing ORS call");
      destinationChanged = true;
      lastCallTime = 0;
    }

    lastDestination = currentDestination;

    // ================= MOVEMENT CHECK =================
    let movedEnough = true;
    let diff = 0;

    if (lastLocation) {
      diff =
        Math.abs(currentLocation[0] - lastLocation[0]) +
        Math.abs(currentLocation[1] - lastLocation[1]);

      // OFF ROUTE
      if (diff > 0.001) { // ~100 meters
        console.log("🚨 Off route → re-routing");
        destinationChanged = true;
        lastCallTime = 0;
      }

      // SMALL MOVEMENT
      if (diff < 0.0003) { // ~30 meters
        movedEnough = false;
      }
    }

    // ================= RATE LIMIT =================
    if (!destinationChanged && !movedEnough) {
      console.log("⏸ No movement → skipping ORS");
      return;
    }

    if (Date.now() - lastCallTime < 10000) {
      console.log("⏳ Waiting before next ORS call");
      return;
    }

    lastLocation = currentLocation;
    lastCallTime = Date.now();

    console.log("📡 Calling ORS...");

    // ================= ORS API =================
    const res = await axios.post(
      "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
      {
        coordinates: [currentLocation, currentDestination]
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

    const routeCoords = res.data.features[0].geometry.coordinates;

    // convert [lon, lat] → [lat, lon]
    const route = routeCoords.map(coord => [coord[1], coord[0]]);

    await db.ref("navigation_device").update({
      instruction,
      distance,
      route   // 🔥 add this
    });

  } catch (err) {
    if (err.response?.status === 403) {
      console.log("🚫 ORS quota finished → stopping calls");
      return;
    }


    console.log("❌ ORS ERROR:", err.response?.data || err.message);


  }
}

// =====================================================
// 🚀 SERVER START
// =====================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

// =====================================================
// 🔁 LOOPS
// =====================================================
setInterval(processVoice, 3000);
setInterval(updateNavigation, 7000);
