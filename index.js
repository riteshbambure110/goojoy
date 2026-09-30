const express = require("express");
const admin = require("firebase-admin");

// Firebase Admin Initialize करें
admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());

// Render के लिए Health Check रूट (ताकि सर्वर एक्टिव रहे)
app.get("/", (req, res) => {
  status(200).send("Goojoy Backend Service is running successfully! 🚀");
});

// =========================================================
// 1. CHAT NOTIFICATION LISTENER (Background Listener)
// =========================================================
db.collectionGroup("messages").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    if (change.type === "added") {
      const messageData = change.doc.data();
      const messageId = change.doc.id;

      if (!messageData || messageData.fcmProcessed) return;

      const receiverGtId = String(messageData.receiverGtId || "").trim();
      const senderGtId = String(messageData.senderGtId || "").trim();
      const messageText = String(messageData.message || "");

      if (!receiverGtId) return;

      try {
        // यूजर ढूंढें
        const userQuery = await db
          .collection("users")
          .where("gtId", "==", receiverGtId)
          .limit(1)
          .get();

        if (userQuery.empty) return;

        const receiverData = userQuery.docs[0].data();
        let tokens = [];

        if (typeof receiverData.fcmToken === "string" && receiverData.fcmToken.trim()) {
          tokens.push(receiverData.fcmToken.trim());
        }
        if (Array.isArray(receiverData.fcmTokens)) {
          tokens.push(...receiverData.fcmTokens.filter(t => typeof t === "string" && t.trim()));
        }

        tokens = [...new Set(tokens)];
        if (tokens.length === 0) return;

        const baseData = {
          senderGtId,
          receiverGtId,
          message: messageText,
          messageId,
          messageType: String(messageData.messageType || "TEXT"),
          timestamp: String(messageData.timestamp || Date.now()),
          type: "CHAT",
        };

        for (const token of tokens) {
          await admin.messaging().send({
            token,
            data: baseData,
            android: { priority: "high" },
          });
        }

        // दोबारा प्रोसेस न हो इसके लिए मार्क करें
        await change.doc.ref.set({ fcmProcessed: true }, { merge: true });
      } catch (error) {
        console.error("Error sending chat notification:", error);
      }
    }
  });
});

// =========================================================
// 2. ORGANIZATION GATE NOTIFICATION LISTENER
// =========================================================
db.collection("user_mailboxes").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    if (change.type === "added" || change.type === "modified") {
      const data = change.doc.data();
      if (!data) return;

      const rawType = data.notificationType || data.eventType || data.type || "";
      const eventType = String(rawType).trim().toUpperCase();

      const isGateEvent =
        eventType.includes("GATE") ||
        eventType.includes("ENTRY") ||
        eventType.includes("EXIT") ||
        eventType.includes("CHECK_IN") ||
        eventType.includes("CHECK_OUT");

      if (!isGateEvent) return;

      const parentGtId = String(data.parentGtId || data.receiverGtId || "").trim().toUpperCase();
      if (!parentGtId) return;

      const eventKey = `${parentGtId}_${eventType}_${data.timestamp || Date.now()}`;
      if (data.lastFcmEventKey === eventKey) return;

      try {
        const userQuery = await db
          .collection("users")
          .where("gtId", "==", parentGtId)
          .limit(1)
          .get();

        if (userQuery.empty) return;

        const receiverData = userQuery.docs[0].data();
        let tokens = [];

        if (typeof receiverData.fcmToken === "string" && receiverData.fcmToken.trim()) {
          tokens.push(receiverData.fcmToken.trim());
        }

        tokens = [...new Set(tokens)];
        if (tokens.length === 0) return;

        const messageText = String(data.message || data.body || "Gate update received.");

        const baseData = {
          type: eventType,
          message: messageText,
          timestamp: String(data.timestamp || Date.now()),
        };

        for (const token of tokens) {
          await admin.messaging().send({
            token,
            data: baseData,
            android: { priority: "high" },
          });
        }

        await change.doc.ref.set({ lastFcmEventKey: eventKey }, { merge: true });
      } catch (error) {
        console.error("Error sending gate notification:", error);
      }
    }
  });
});

// Server Start (Render के लिए PORT ज़रूरी है)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Goojoy backend server is running on port ${PORT}`);
});
