import ipinfo from "ipinfo";

export function detectZone(req, res, next) {
  if (req.headers["x-user-zone"]) return next();

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  console.log("IP to lookup:", ip);

  // Check for localhost or private IPs
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.")
  ) {
    req.headers["x-user-zone"] = "IN"; // or your default
    req.headers["x-user-country"] = "IN";
    return next();
  }

  ipinfo(ip, process.env.IPINFO_TOKEN, (err, data) => {
    if (!err && data?.country) {
      const zone = mapCountryToZone(data.country);
      req.headers["x-user-zone"] = zone;
      req.headers["x-user-country"] = data.country;
    } else {
      console.warn("IP info failed:", err?.message || err);
      req.headers["x-user-zone"] = "ROW";
      req.headers["x-user-country"] = "ROW";
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
