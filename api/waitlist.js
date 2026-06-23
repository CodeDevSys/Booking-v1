const calendar = require("../server/calendar");
const waitlist = require("../server/waitlist");

const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_KEY = "123456";

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

function checkAdminKey(req) {
  const expectedUser = process.env.ADMIN_USER || DEFAULT_ADMIN_USER;
  const expected = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
  const providedUser = req.query?.user || req.headers?.["x-admin-user"];
  const provided = req.query?.key || req.headers?.["x-admin-key"];
  if (providedUser !== expectedUser || provided !== expected) {
    return { ok: false, message: "Falscher Benutzername oder falsches Passwort.", status: 401 };
  }
  return { ok: true };
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

  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });

  try {
    await ensureReady();

    if (req.method === "GET") {
      const data = await waitlist.listWaitlist({ baseUrl: requestBaseUrl(req) });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const body = getBody(req);
      if (!body) return res.status(400).json({ error: "Ungültiger JSON-Body" });
      const entry = waitlist.createWaitlistEntry(body);
      return res.status(201).json({ entry });
    }

    return res.status(405).json({ error: "Methode nicht erlaubt" });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.message || "Serverfehler" });
  }
};
