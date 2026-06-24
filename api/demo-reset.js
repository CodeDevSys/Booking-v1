const calendar = require("../server/calendar");
const waitlist = require("../server/waitlist");

const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_KEY = "123456";

let ready = null;

function ensureReady() {
  if (!ready) ready = calendar.initGoogleCalendar();
  return ready;
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

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Methode nicht erlaubt" });
  }

  const auth = checkAdminKey(req);
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });

  try {
    await ensureReady();
    const data = await waitlist.resetDemoData();
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.message || "Serverfehler" });
  }
};
