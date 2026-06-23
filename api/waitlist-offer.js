const calendar = require("../server/calendar");
const waitlist = require("../server/waitlist");

let ready = null;

function ensureReady() {
  if (!ready) ready = calendar.initGoogleCalendar();
  return ready;
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}

function requestBaseUrl(req) {
  if (process.env.WAITLIST_PUBLIC_BASE_URL) return process.env.WAITLIST_PUBLIC_BASE_URL;
  const host = req.headers?.host;
  const protocol = req.headers?.["x-forwarded-proto"] || "https";
  return host ? `${protocol}://${host}` : "";
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    await ensureReady();

    if (req.method === "GET") {
      const token = req.query?.token;
      if (!token) return res.status(400).json({ error: "Angebots-Token erforderlich" });
      const offer = await waitlist.getOfferByToken(token, { baseUrl: requestBaseUrl(req) });
      return res.status(200).json({ offer });
    }

    if (req.method === "POST") {
      const body = getBody(req);
      if (!body) return res.status(400).json({ error: "Ungültiger JSON-Body" });
      const token = body.token || req.query?.token;
      if (!token) return res.status(400).json({ error: "Angebots-Token erforderlich" });
      const result = await waitlist.claimOffer(token);
      return res.status(201).json(result);
    }

    return res.status(405).json({ error: "Methode nicht erlaubt" });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.message || "Serverfehler" });
  }
};
