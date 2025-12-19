export function normalizeWarmupMode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "OFF") return "OFF";
  if (raw === "MANUAL_ONLY") return "MANUAL_ONLY";
  return "AUTO";
}

export function normalizeWarmupStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "INACTIVE") return "INACTIVE";
  if (raw === "PAUSED") return "PAUSED";
  if (raw === "COMPLETED") return "COMPLETED";
  return "ACTIVE";
}
