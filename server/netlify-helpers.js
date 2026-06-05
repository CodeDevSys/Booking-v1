process.env.NETLIFY = "true";

const calendar = require("./calendar");
const openai = require("./openai");

const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_KEY = "123456";

let ready = null;

function ensureReady() {
  if (!ready) {
    ready = calendar.initGoogleCalendar();
  }
  return ready;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function error(statusCode, message) {
  return json(statusCode, { error: message });
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

function checkAdminKey(event) {
  const expectedUser = process.env.ADMIN_USER || DEFAULT_ADMIN_USER;
  const expected = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
  const providedUser =
    event.queryStringParameters?.user ||
    event.headers?.["x-admin-user"] ||
    event.headers?.["X-Admin-User"];
  const provided =
    event.queryStringParameters?.key ||
    event.headers?.["x-admin-key"] ||
    event.headers?.["X-Admin-Key"];
  if (providedUser !== expectedUser || provided !== expected) {
    return { ok: false, message: "Falscher Benutzername oder falsches Passwort.", status: 401 };
  }
  return { ok: true };
}

module.exports = { calendar, openai, ensureReady, json, error, parseBody, checkAdminKey };
