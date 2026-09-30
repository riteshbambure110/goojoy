const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

exports.sendChatNotification = functions.firestore
  .document("chats/{chatId}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const messageData = snapshot.data();

    if (!messageData) {
      console.log("Chat message data missing.");
      return null;
    }

    const receiverGtId = String(
      messageData.receiverGtId || ""
    ).trim();

    const senderGtId = String(
      messageData.senderGtId || ""
    ).trim();

    const messageText = String(
      messageData.message || ""
    );

    if (!receiverGtId) {
      console.log(
        "Receiver GT-ID missing for chat notification."
      );
      return null;
    }

    const userQuery = await db
      .collection("users")
      .where("gtId", "==", receiverGtId)
      .limit(1)
      .get();

    if (userQuery.empty) {
      console.log(
        "Receiver not found for GT-ID:",
        receiverGtId
      );
      return null;
    }

    const receiverData = userQuery.docs[0].data();

    let tokens = [];

    if (
      typeof receiverData.fcmToken === "string" &&
      receiverData.fcmToken.trim()
    ) {
      tokens.push(
        receiverData.fcmToken.trim()
      );
    }

    if (Array.isArray(receiverData.fcmTokens)) {
      tokens.push(
        ...receiverData.fcmTokens.filter(
          (token) =>
            typeof token === "string" &&
            token.trim()
        )
      );
    }

    if (Array.isArray(receiverData.notificationTokens)) {
      tokens.push(
        ...receiverData.notificationTokens.filter(
          (token) =>
            typeof token === "string" &&
            token.trim()
        )
      );
    }

    tokens = [...new Set(tokens)];

    if (tokens.length === 0) {
      console.log(
        "No FCM Token registered for GT-ID:",
        receiverGtId
      );
      return null;
    }

    const baseData = {
      senderGtId: senderGtId,
      receiverGtId: receiverGtId,
      message: messageText,
      messageId: String(
        context.params.messageId || ""
      ),
      messageType: String(
        messageData.messageType || "TEXT"
      ),
      timestamp: String(
        messageData.timestamp || Date.now()
      ),
      isEdited: String(
        messageData.isEdited || false
      ),
      status: String(
        messageData.status || "delivered"
      ),
      mediaUrl: String(
        messageData.mediaUrl || ""
      ),
      contactName: String(
        messageData.contactName || ""
      ),
      contactPhone: String(
        messageData.contactPhone || ""
      ),
      type: "CHAT",
    };

    let sentCount = 0;
    let failedCount = 0;

    for (const token of tokens) {
      try {
        const response = await admin.messaging().send({
          token: token,
          data: baseData,
          android: {
            priority: "high",
          },
        });

        console.log(
          "Private chat DATA-ONLY push sent:",
          response,
          "receiver:",
          receiverGtId
        );

        sentCount++;
      } catch (error) {
        console.error(
          "Private chat push failed for token:",
          token,
          error
        );

        failedCount++;
      }
    }

    console.log(
      "Private chat notification completed:",
      {
        senderGtId: senderGtId,
        receiverGtId: receiverGtId,
        sentCount: sentCount,
        failedCount: failedCount,
      }
    );

    return null;
  });

exports.sendOrganizationGateNotification =
  functions.firestore
    .document("user_mailboxes/{parentGtId}")
    .onWrite(async (change, context) => {
      if (!change.after.exists) {
        return null;
      }

      const data = change.after.data();

      if (!data) {
        return null;
      }

      const rawType =
        data.notificationType ||
        data.eventType ||
        data.messageType ||
        data.type ||
        "";

      const eventType = String(rawType)
        .trim()
        .toUpperCase();

      const isGateEvent =
        eventType.includes("GATE") ||
        eventType.includes("ENTRY") ||
        eventType.includes("EXIT") ||
        eventType.includes("CHECK_IN") ||
        eventType.includes("CHECK_OUT");

      if (!isGateEvent) {
        return null;
      }

      const parentGtId = String(
        data.parentGtId ||
        data.receiverGtId ||
        data.targetGtId ||
        context.params.parentGtId ||
        ""
      )
        .trim()
        .toUpperCase();

      if (!parentGtId) {
        console.log(
          "Organization gate notification: parent GT-ID missing."
        );
        return null;
      }

      const orgId = String(
        data.orgId ||
        data.senderGtId ||
        data.instituteId ||
        ""
      )
        .trim()
        .toUpperCase();

      const orgName = String(
        data.orgName ||
        data.organizationName ||
        data.senderName ||
        "Organization"
      );

      const studentName = String(
        data.studentName ||
        data.childName ||
        ""
      );

      const messageText = String(
        data.message ||
        data.body ||
        (
          eventType.includes("EXIT") ||
          eventType.includes("CHECK_OUT")
            ? `${studentName || "Your child"} has exited the campus.`
            : `${studentName || "Your child"} has entered the campus.`
        )
      );

      const timestamp = String(
        data.timestamp ||
        data.createdAt ||
        Date.now()
      );

      const eventKey = [
        parentGtId,
        orgId,
        eventType,
        studentName,
        messageText,
        timestamp,
      ].join("|");

      if (data.lastFcmEventKey === eventKey) {
        console.log(
          "Duplicate organization gate event ignored:",
          eventKey
        );
        return null;
      }

      const userQuery = await db
        .collection("users")
        .where("gtId", "==", parentGtId)
        .limit(1)
        .get();

      if (userQuery.empty) {
        console.log(
          "Parent user not found for GT-ID:",
          parentGtId
        );
        return null;
      }

      const receiverData = userQuery.docs[0].data();

      let tokens = [];

      if (
        typeof receiverData.fcmToken === "string" &&
        receiverData.fcmToken.trim()
      ) {
        tokens.push(
          receiverData.fcmToken.trim()
        );
      }

      if (Array.isArray(receiverData.fcmTokens)) {
        tokens.push(
          ...receiverData.fcmTokens.filter(
            (token) =>
              typeof token === "string" &&
              token.trim()
          )
        );
      }

      if (Array.isArray(receiverData.notificationTokens)) {
        tokens.push(
          ...receiverData.notificationTokens.filter(
            (token) =>
              typeof token === "string" &&
              token.trim()
          )
        );
      }

      tokens = [...new Set(tokens)];

      if (tokens.length === 0) {
        console.log(
          "No FCM Token registered for parent GT-ID:",
          parentGtId
        );
        return null;
      }

      const baseData = {
        type: eventType,
        notificationType: eventType,
        eventType: eventType,
        messageType: "GATE",
        senderGtId: orgId,
        receiverGtId: parentGtId,
        parentGtId: parentGtId,
        orgId: orgId,
        orgName: orgName,
        senderName: orgName,
        studentName: studentName,
        message: messageText,
        body: messageText,
        timestamp: timestamp,
        eventKey: eventKey,
      };

      let sentCount = 0;
      let failedCount = 0;

      for (const token of tokens) {
        try {
          const response = await admin.messaging().send({
            token: token,
            data: baseData,
            android: {
              priority: "high",
            },
          });

          console.log(
            "Organization gate push sent:",
            response,
            "parent:",
            parentGtId
          );

          sentCount++;
        } catch (error) {
          console.error(
            "Organization gate push failed for token:",
            token,
            error
          );

          failedCount++;
        }
      }

      await change.after.ref.set(
        {
          lastFcmEventKey: eventKey,
          fcmSent: sentCount > 0,
          fcmSentCount: sentCount,
          fcmFailedCount: failedCount,
          fcmProcessedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      console.log(
        "Organization gate notification completed:",
        {
          parentGtId: parentGtId,
          orgId: orgId,
          eventType: eventType,
          sentCount: sentCount,
          failedCount: failedCount,
        }
      );

      return null;
    });
