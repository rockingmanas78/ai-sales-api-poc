// controllers/snsController.js
import axios from "axios";

export const handleSnsEvent = async (req, res) => {
  try {
    const snsMessage = JSON.parse(req.body.toString());

    if (snsMessage.Type === "SubscriptionConfirmation") {
      console.log("SNS Subscription confirmation received.");
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed.");
    }

    if (snsMessage.Type === "Notification") {
      const message = JSON.parse(snsMessage.Message); // the actual SES event is inside `Message`

      console.log("📩 SES Event Received:", message.eventType);

      // Optional DB logic here
      switch (message.eventType) {
        case "Send":
          break;
        case "Open":
          break;
        case "Click":
          break;
        case "Bounce":
          break;
        default:
          console.log("Unhandled eventType:", message.eventType);
      }

      return res.status(200).send("Notification processed.");
    }

    return res.status(200).send("OK"); // fallback
  } catch (error) {
    console.error("Error handling SNS message:", error);
    return res.status(400).send("Invalid SNS message.");
  }
};
