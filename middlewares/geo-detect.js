import ipinfo from "ipinfo";

export function detectZone(req, res, next) {
  if (req.headers["x-user-zone"]) return next();

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  ipinfo(ip, process.env.IPINFO_TOKEN, (err, data) => {
    if (!err && data?.country) {
      const zone = mapCountryToZone(data.country);
      req.headers["x-user-zone"] = zone;
      req.headers["x-user-country"] = data.country;
    } else {
      console.warn("IP info failed:", err);
    }
    next();
  });
}


export function mapCountryToZone(cc) {
  if (cc === "IN") return "IN";
  if (["AE", "SA", "QA"].includes(cc)) return "AE";
  if (["US", "CA"].includes(cc)) return "US";
  if (["DE", "FR", "NL", "IT", "ES"].includes(cc)) return "EU";
  return "ROW";
}
