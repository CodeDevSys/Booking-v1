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

  if (req.method === "GET") {
    const auth = checkAdminKey(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });

    try {
      await ensureReady();
      const bookings = await calendar.listBookings();
      return res.status(200).json({ bookings });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || "Serverfehler" });
    }
  }

  if (req.method === "DELETE") {
    const auth = checkAdminKey(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });

    try {
      await ensureReady();
      const bookings = await calendar.listBookings();
      const cancelled = bookings.find((booking) => booking.id === req.query?.id);
      const deleted = await calendar.deleteBooking(req.query?.id);
      const waitlistResult = await waitlist.createOffersForCancellation(cancelled || deleted, {
        baseUrl: requestBaseUrl(req),
      });
      return res.status(200).json({ deleted, waitlist: waitlistResult });
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || "Serverfehler" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Methode nicht erlaubt" });
  }

  try {
    await ensureReady();
    const body = getBody(req);
    if (!body) return res.status(400).json({ error: "Ungültiger JSON-Body" });

    const { date, start, name, email, notes, service } = body;
    if (!date || !start || !name || !email) {
      return res.status(400).json({ error: "Datum, Startzeit, Name und E-Mail sind erforderlich" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
    }

    const booking = await calendar.createBooking({
      date,
      start,
      name: name.trim(),
      email: email.trim(),
      notes,
      service,
    });
    return res.status(201).json({ booking });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.message || "Serverfehler" });
  }
};
