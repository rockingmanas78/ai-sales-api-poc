import { computeTenantReputation } from "../services/reputation.service.js";

export const getTenantReputation = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const window = req.query.window || "30d";

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const data = await computeTenantReputation(tenantId, window);
    return res.json(data);
  } catch (err) {
    console.error("getTenantReputation error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getTenantSpamRate = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const window = req.query.window || "30d";

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const data = await computeTenantSpamRate(tenantId, window);
    return res.json(data);
  } catch (err) {
    console.error("getTenantSpamRate error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
