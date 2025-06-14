import axios from 'axios';

export const handleSnsEvent = async (req, res) => {
  try {
    let snsMessage;

    // Support raw body from AWS SNS
    if (Buffer.isBuffer(req.body)) {
      const rawBody = req.body.toString("utf-8");
      snsMessage = JSON.parse(rawBody);
    } else {
      return res.status(400).send("Unsupported body format.");
    }

    console.log("📨 SNS Message Type:", snsMessage.Type);

    // 1. Handle subscription confirmation
    if (snsMessage.Type === "SubscriptionConfirmation") {
      console.log("🔔 SubscriptionConfirmation received");
      console.log("🔗 Confirming subscription:", snsMessage.SubscribeURL);

      // Automatically confirm the subscription
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed");
    }

    // 2. Handle notification
    if (snsMessage.Type === "Notification") {
      const sesEvent = JSON.parse(snsMessage.Message); // actual SES payload
      console.log("📩 SES Event Received:", sesEvent.eventType);

      switch (sesEvent.eventType) {
        case "Send":
          // update sent status
          break;
        case "Open":
          // update open tracking
          break;
        case "Click":
          // update click tracking
          break;
        case "Bounce":
          // update bounce status
          break;
        default:
          console.log("⚠️ Unhandled eventType:", sesEvent.eventType);
      }

      return res.status(200).send("Notification processed");
    }

    return res.status(200).send("Unhandled message type");
  } catch (error) {
    console.error("❌ SNS Handler Error:", error);
    return res.status(500).send("Internal server error");
  }
};
