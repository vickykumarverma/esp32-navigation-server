require("dotenv").config();

const express = require("express");
const app = express();
const axios = require("axios");
const admin = require("firebase-admin");
const fs = require("fs");

// ---------------- FIREBASE ----------------
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DATABASE_URL
});

const db = admin.database();

// ---------------- API KEYS ----------------
const ORS_KEY = process.env.ORS_API_KEY;
const ASSEMBLY_API_KEY = process.env.ASSEMBLY_API_KEY;

// =====================================================
// 🔥 ASSEMBLY AI STT FUNCTION
// =====================================================
async function speechToText() {
  try {
    const audioData = fs.readFileSync("input.wav");

    // Upload
    const uploadRes = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      audioData,
      {
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "transfer-encoding": "chunked"
        }
      }
    );

    const audio_url = uploadRes.data.upload_url;

    // Request transcription
    const transcriptRes = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      { audio_url },
      {
        headers: { authorization: ASSEMBLY_API_KEY }
      }
    );

    const id = transcriptRes.data.id;

    // Poll result
    while (true) {
      const res = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${id}`,
        { headers: { authorization: ASSEMBLY_API_KEY } }
      );

      if (res.data.status === "completed") {
        return res.data.text;
      }

      if (res.data.status === "failed") {
        throw new Error("STT failed");
      }

      await new Promise(r => setTimeout(r, 2000));
    }

  } catch (err) {
    console.log("❌ STT ERROR:", err.message);
    return null;
  }
}

// =====================================================
// 🔥 VOICE PROCESS FUNCTION
// =====================================================
async function processVoice() {
  try {
    const ref = db.ref("voice");
    const snap = await ref.once("value");

    const data = snap.val();

    if (!data || !data.request) return;

    console.log("🎤 Voice request received");

    const text = await speechToText();

    if (!text) {
      await ref.update({
        status: "failed",
        request: false
      });
      return;
    }

    console.log("🗣️ Result:", text);

    await ref.update({
      status: "done",
      result: text,
      request: false
    });

  } catch (err) {
    console.log("❌ Voice Processing Error:", err.message);

    await db.ref("voice").update({
      status: "failed",
      request: false
    });
  }
}

// =====================================================
// 🔥 ORS NAVIGATION FUNCTION
// =====================================================
async function updateNavigation() {
  try {
    const snap = await db.ref("navigation_device").once("value");
    const data = snap.val();

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

    // 🔥 Normalize
    if (instruction.includes("left")) instruction = "LEFT";
    else if (instruction.includes("right")) instruction = "RIGHT";
    else instruction = "STRAIGHT";

    const distance = Math.round(step.distance);

    console.log("➡", instruction, distance);

    await db.ref("navigation_device").update({
      instruction,
      distance
    });

  } catch (err) {
    console.log("ORS ERROR:", err.message);
  }
}

// =====================================================
// 🔁 MAIN LOOP
// =====================================================

// Voice check every 3 sec
setInterval(processVoice, 3000);

// Navigation update every 5 sec
setInterval(updateNavigation, 5000);

// =====================================================
// 🌐 EXPRESS SERVER (ADD HERE)
// =====================================================
app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});