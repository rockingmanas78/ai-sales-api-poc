import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import authRouter from './routes/auth.route.js';
import tenantRouter from './routes/tenant.route.js';
import userRouter from './routes/user.route.js';
import leadRouter from './routes/lead.route.js';
import templateRouter from './routes/emailTemplate.route.js';
import campaignRouter from './routes/campaign.route.js';
import logRouter from './routes/emailLog.route.js';
import emailRoutes  from "./routes/ses.route.js";
import snsRoutes from "./routes/sns.route.js";
import bodyParser from 'body-parser';
import leadGenRouter from './routes/leadGenJob.route.js';
//import reportRouter from './routes/report.route.js';
const app = express();

dotenv.config();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
];
app.use(express.json());

app.use(cors({
    origin: (origin, callback) => {
      // origin will be undefined for non-browser requests (e.g., Postman). 
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));





// Mount all routers
app.use('/auth', authRouter);
app.use('/tenants', tenantRouter);
app.use('/users', userRouter);
app.use('/lead-jobs', leadGenRouter);
app.use('/leads', leadRouter);
app.use('/templates', templateRouter);
app.use('/campaigns', campaignRouter);
app.use('/email-logs', logRouter);
app.use("/api/aws", emailRoutes);
//app.use('/reports', reportRouter);
app.use('/api', bodyParser.raw({ type: '*/*' }), snsRoutes);
 
// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server runs on port ${PORT}`));
