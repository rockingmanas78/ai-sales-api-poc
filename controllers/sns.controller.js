// controllers/snsController.js
import axios from "axios";

export const handleSnsEvent = async (req, res) => {
  const snsMessage = req.body;

  // 1. Handle subscription confirmation
  if (snsMessage.Type === "SubscriptionConfirmation") {
    try {
      console.log("SNS Subscription confirmation received.");
      console.log("SubscribeURL:", snsMessage.SubscribeURL);

      // Automatically confirm subscription
      await axios.get(snsMessage.SubscribeURL);
      console.log("✅ SNS Subscription confirmed.");
      return res.status(200).send("Subscription confirmed.");
    } catch (err) {
      console.error("❌ Failed to confirm SNS subscription:", err);
      return res.status(500).send("Failed to confirm subscription.");
    }
  }

  // 2. Handle actual notifications
  if (snsMessage.Type === "Notification") {
    try {
      const message = JSON.parse(snsMessage.Message); // SES event payload is inside `Message`

      console.log("📩 SES Event Received:", message.eventType);
      // Do something based on event type
      switch (message.eventType) {
        case "Send":
          console.log("✉️ Email sent");
          break;
        case "Open":
          console.log("👀 Email opened");
          break;
        case "Click":
          console.log("🔗 Email link clicked");
          break;
        case "Bounce":
          console.log("🚫 Email bounced");
          break;
        default:
          console.log("ℹ️ Unhandled eventType:", message.eventType);
      }

      return res.status(200).send("Notification processed.");
    } catch (err) {
      console.error("Error processing SES event:", err);
      return res.status(400).send("Invalid message format.");
    }
  }

  return res.status(200).send("OK"); // Fallback for unknown messages
};
