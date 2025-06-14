import axios from "axios";

export const handleSnsEvent = async (req, res) => {
  try {
    let snsMessage;

    if (Buffer.isBuffer(req.body)) {
      // Coming from raw body (AWS SNS production)
      snsMessage = JSON.parse(req.body.toString("utf-8"));
    } else if (typeof req.body === "object") {
      // Likely local test (like Postman or body-parser fallback)
      snsMessage = req.body;
    } else {
      return res.status(400).send("Unsupported body format.");
    }

    // 1. Subscription confirmation
    if (snsMessage.Type === "SubscriptionConfirmation") {
      console.log("🔔 SNS subscription confirmation received.");
      console.log("📎 Confirming via:", snsMessage.SubscribeURL);
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed.");
    }

    // 2. SES Event Notification
    if (snsMessage.Type === "Notification") {
      const sesEvent = JSON.parse(snsMessage.Message); // Actual SES payload
      console.log("📩 SES Event:", sesEvent.eventType);

      switch (sesEvent.eventType) {
        case "Send":
          // update DB sent status
          break;
        case "Open":
          // update DB open status
          break;
        case "Click":
          // update DB click status
          break;
        case "Bounce":
          // update DB bounced
          break;
        default:
          console.log("Unhandled eventType:", sesEvent.eventType);
      }

      return res.status(200).send("SES Notification handled.");
    }

    return res.status(200).send("Unhandled SNS message type.");
  } catch (err) {
    console.error("❌ Error handling SNS message:", err);
    return res.status(500).send("Internal Server Error");
  }
};
