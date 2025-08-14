import dotenv from 'dotenv';
dotenv.config();

const AI_SERVICE_ENDPOINT_STAGE = process.env.AI_SERVICE_URL_STAGE ?? "https://lead-generation-staging.up.railway.app";
const AI_SERVICE_ENDPOINT_PROD = process.env.AI_SERVICE_URL_PROD ?? "https://lead-generation-production-d101.up.railway.app";

export const AI_SERVICE_ENDPOINT = process.env.NODE_ENV === "production" ? AI_SERVICE_ENDPOINT_PROD : AI_SERVICE_ENDPOINT_STAGE;