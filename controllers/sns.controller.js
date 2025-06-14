import axios from "axios";

export const handleSnsEvent = async (req, res) => {
  try {
    const rawBody = req.body?.toString?.(); // Check if toString exists
    if (!rawBody) {
      return res.status(400).send("No body received.");
    }

    const snsMessage = JSON.parse(rawBody);

    // 1. Handle SNS Subscription Confirmation
    if (snsMessage.Type === "SubscriptionConfirmation") {
      console.log("🔔 SNS subscription confirmation received.");
      console.log("📎 Confirming via:", snsMessage.SubscribeURL);
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed.");
    }

    // 2. Handle actual SES Notification
    if (snsMessage.Type === "Notification") {
      const sesEvent = JSON.parse(snsMessage.Message); // SES sends JSON inside "Message"
      console.log("📩 SES Event:", sesEvent.eventType);

      // Custom DB update logic here
      switch (sesEvent.eventType) {
        case "Send":
          // Update status: sent
          break;
        case "Open":
          // Update status: opened
          break;
        case "Click":
          // Update status: clicked
          break;
        case "Bounce":
          // Mark email as bounced
          break;
        default:
          console.log("❓ Unhandled eventType:", sesEvent.eventType);
      }

      return res.status(200).send("Notification handled.");
    }

    return res.status(200).send("Unhandled message type.");
  } catch (err) {
    console.error("❌ Error handling SNS message:", err);
    return res.status(500).send("Error processing SNS message.");
  }
};
