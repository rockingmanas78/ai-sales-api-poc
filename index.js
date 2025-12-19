import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import authRouter from "./routes/auth.route.js";
import tenantRouter from "./routes/tenant.route.js";
import userRouter from "./routes/user.route.js";
import leadRouter from "./routes/lead.route.js";
import templateRouter from "./routes/emailTemplate.route.js";
import campaignRouter from "./routes/campaign.route.js";
import logRouter from "./routes/emailLog.route.js";
import emailRoutes from "./routes/ses.route.js";
import snsRoutes from "./routes/sns.route.js";
import bodyParser from "body-parser";
import leadGenRouter from "./routes/leadGenJob.route.js";
import bulkEmailRouter from "./routes/bulkEmail.routes.js";
import { processNextBatch } from "./controllers/bulkEmail.controller.js";
import pricingRoute from "./routes/pricing.route.js";
import updateSubscriptionRoute from "./routes/updateSubscription.route.js";
import dashboardRouter from "./routes/dashboard.route.js";
import analyticsRouter from "./routes/analytics.route.js";
import companyProfileRouter from "./routes/companyProfile.route.js";
import companyQARouter from "./routes/companyQA.route.js";
import productRouter from "./routes/product.route.js";
import productQARoutes from "./routes/productQA.route.js";
import knowledgeDocumentRouter from "./routes/knowledgeDocument.route.js";
import websiteRoutes from "./routes/websiteContent.route.js";
import bulkSnippetRoutes from "./routes/bulkSnippet.routes.js";
import waitListRouter from "./routes/waitList.route.js";
import feedbackRouter from "./routes/feedback.route.js";
import conversationRoutes from "./routes/conversation.route.js";
import tenantOnboardingRoutes from "./routes/tenantOnboarding.routes.js";
import eventsRouter from "./routes/events.route.js";
import emailRouter from "./routes/email.route.js";
import webhookRouter from "./routes/webhooks.route.js";
import csvRouter from "./routes/csvImport.route.js";
import reputationRouter from "./routes/reputation.route.js";
import emailVerificationRouter from "./routes/emailVerification.route.js";
import warmupProfile from "./routes/warmup.profile.routes.js";
import warmupInbox from "./routes/warmup.inbox.routes.js";
import warmupScheduler from "./routes/warmup.scheduler.routes.js";
import warmWebhook from "./routes/warmup.webhook.routes.js";
import warmupMessage from "./routes/warmup.message.routes.js"
import  warmupThread  from "./routes/warmup.thread.routes.js";
import warmupMessageEvent from "./routes/warmup.messageEvent.routes.js";
import { startBulkEmailWorker, startCsvJobWorker } from "./jobs/jobWorkers.js";

const app = express();

dotenv.config();

const allowedOrigins = [
  // 'http://localhost:3000',
  // 'http://localhost:8080',
  // 'https://dashboard.salefunnel.in',
  // 'https://3da281c9-e9f5-4010-97e2-26aa63b08eec.lovableproject.com'
];

app.use(
  "/api/webhooks",
  express.raw({ type: "application/json" }),
  webhookRouter
);

app.use("/api", snsRoutes);

app.use(express.json());

app.use(
  cors({
    // origin: (origin, callback) => {
    //   // origin will be undefined for non-browser requests (e.g., Postman).
    //   if (!origin || allowedOrigins.includes(origin)) {
    //     callback(null, true);
    //   } else {
    //     callback(new Error('Not allowed by CORS'));
    //   }
    // },
    origin: (origin, callback) => callback(null, true),
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Cache-Control",
      "Pragma",
      "Expires",
      "idempotency-key",
      "x-ingest-key",
    ],
    credentials: true,
  })
);

// Mount all other routers
app.use("/api/auth", authRouter);
app.use("/api/tenants", tenantRouter);
app.use("/api/users", userRouter);
app.use("/api/lead-jobs", leadGenRouter);
app.use("/api/leads", leadRouter);
app.use("/api/templates", templateRouter);
app.use("/api/campaigns", campaignRouter);
app.use("/api/email-logs", logRouter);
app.use("/api/aws", emailRoutes);
app.use("/api", bulkEmailRouter);
app.use("/api/plan", pricingRoute);
app.use("/api/subscription", updateSubscriptionRoute);
app.use("/api", dashboardRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/company", companyProfileRouter);
app.use("/api", companyQARouter);
app.use("/api", productRouter);
app.use("/api/products/:productId/qa", productQARoutes);
app.use("/api/documents", knowledgeDocumentRouter);
app.use("/api/websites", websiteRoutes);
app.use("/api/snippets", bulkSnippetRoutes);
app.use("/api", waitListRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/tenant", tenantOnboardingRoutes);
app.use("/api/events", eventsRouter);
app.use("/api/conversations", conversationRoutes);
app.use("/api/email", emailRouter);
app.use("/api/csv", csvRouter);
app.use("/api/reputation", reputationRouter);
app.use("/api/email-verification", emailVerificationRouter);
app.use("/api/warmup/profile",warmupProfile)
app.use("/api/warmup/inbox",warmupInbox);
app.use("/api/warmup/scheduler",warmupScheduler);
app.use("/api/warmup/webhook",warmWebhook);
app.use("/api/warmup/message",warmupMessage);
app.use("/api/warmup/thread",warmupThread);
app.use("/api/warmup/event",warmupMessageEvent);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

startBulkEmailWorker();
startCsvJobWorker();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server runs on port ${PORT}`);
  processNextBatch();
});
