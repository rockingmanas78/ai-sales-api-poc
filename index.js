import express from 'express';
import dotenv from 'dotenv';

import authRouter from './routes/auth.route.js';
import tenantRouter from './routes/tenant.route.js';
import userRouter from './routes/user.route.js';
//import jobRouter from './routes/leadGenJob.route.js';
import leadRouter from './routes/lead.route.js';
import templateRouter from './routes/emailTemplate.route.js';
import campaignRouter from './routes/campaign.route.js';
import logRouter from './routes/emailLog.route.js';
//import reportRouter from './routes/report.route.js';

dotenv.config();

const app = express();
app.use(express.json());

// Mount all routers
app.use('/auth', authRouter);
app.use('/tenants', tenantRouter);
app.use('/users', userRouter);
// app.use('/lead-jobs', jobRouter);
app.use('/leads', leadRouter);
app.use('/templates', templateRouter);
app.use('/campaigns', campaignRouter);
app.use('/email-logs', logRouter);
//app.use('/reports', reportRouter);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
