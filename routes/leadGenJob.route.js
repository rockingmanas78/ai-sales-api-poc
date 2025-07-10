import { Router } from 'express';
import { searchAndExtract } from '../controllers/leadGenJob.controller.js';
const router = Router();
import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

// POST /api/search_and_extract
router.post('/search_and_extract', verifyToken(), authorize('manage_leads'),searchAndExtract);

export default router;

// import { Router } from 'express';
// import { enqueueJob, getJobs, getJobById, updateJob, deleteJob } from '../controllers/leadGenJobController.js';
// const jobRouter = Router();

// // Enqueue a new lead generation job
// jobRouter.post('/', enqueueJob);
// // Get all jobs
// jobRouter.get('/', getJobs);
// // Get single job
// jobRouter.get('/:jobId', getJobById);
// // Update job status/details
// jobRouter.put('/:jobId', updateJob);
// // Delete job
// jobRouter.delete('/:jobId', deleteJob);

// export default jobRouter;
