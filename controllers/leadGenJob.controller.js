import axios from "axios";
import { PrismaClient } from "@prisma/client";
// 1. Import the recordUsage helper function

const prisma = new PrismaClient();
import { AI_SERVICE_ENDPOINT } from "../constants/endpoints.constants.js";

export const searchAndExtract = async (req, res) => {
  // The middleware has already checked the limits, now we execute and record.
  try {
    console.log("search and extract!");
    const { tenantId } = req.user;
    const { prompt, num_results = 1, offset = 0 } = req.body;

    console.log("Body", req.body);

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    console.log("Endpoint", `${AI_SERVICE_ENDPOINT}/api/extract/search`);
    // AI service ko call karein
    // 2. Create a record of the job in your database first
    // const newJob = await prisma.leadGenerationJob.create({
    //   data: {
    //     tenantId: tenantId,
    //     prompt: prompt,
    //     status: "QUEUED", // Set an initial status
    //     totalRequested: num_results,
    //   },
    // });

    // 3. Call the AI service to start the job
    const { data } = await axios.post(
      `${AI_SERVICE_ENDPOINT}/api/extract/search`,
      { prompt, num_results, offset, contact_focus: "email", exclude_aggregators: false },
      {
        headers: {
          Authorization: incomingAuth,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("AI service returned data:", data);

    // Optionally, update your job record with the batchId from the AI service
    // if (data.job_id) {
    //   await prisma.leadGenerationJob.update({
    //     where: { id: newJob.id },
    //     data: { batchId: data.job_id, status: "PROCESSING" },
    //   });
    // }

    return res.status(200).json(data);
  } catch (err) {
    console.log("err", err.response.data);
    // console.error("searchAndExtract error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getSearchJobStatus = async (req, res) => {
  try {
    const { tenantId, job_id } = req.query;
    if (!tenantId || !job_id) {
      return res
        .status(400)
        .json({ error: "tenantId and job_id are required" });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    // 3. Fetch the job status/results from the AI service
    const statusUrl = `${AI_SERVICE_ENDPOINT}/api/extract/get_job_update?job_id=${job_id}`;
    console.log(statusUrl);
    const { data } = await axios.get(statusUrl, {
      headers: {
        Authorization: incomingAuth,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error(
      "getSearchJobStatus error:",
      err.response?.data || err.message
    );
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getJobsByTenant = async (req, res) => {
  try {
    const { tenantId } = req.query;

    if (!tenantId) {
      return res
        .status(400)
        .json({ error: "Tenant ID is required in the query." });
    }

    const jobs = await prisma.leadGenerationJob.findMany({
      where: {
        tenantId: tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json(jobs);
  } catch (error) {
    console.error("Error fetching lead generation jobs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
