let client = null;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!client) {
    let OpenAI;
    try {
      OpenAI = require("openai");
    } catch {
      return null;
    }
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

async function parseBookingIntent(message, context = {}) {
  const openai = getClient();
  if (!openai) {
    return {
      enabled: false,
      reply: "Der KI-Assistent ist nicht konfiguriert. Nutze das Formular, um einen Termin zu buchen.",
    };
  }

  const system = `Du hilfst Nutzern auf Deutsch dabei, Friseurtermine für diese Services zu buchen: Haare schneiden, Haarstyling, Haare färben. Öffnungszeiten: ${process.env.BUSINESS_START || 9}:00–${process.env.BUSINESS_END || 17}:00, Mo–Fr, Slots à ${process.env.SLOT_MINUTES || 60} Minuten.
Heute ist ${new Date().toISOString().split("T")[0]}.
Antworte ausschließlich mit JSON: {"reply":"freundliche Nachricht auf Deutsch","action":"none"|"suggest_date"|"suggest_booking","date":"YYYY-MM-DD oder null","time":"HH:MM 24h oder null","name":null,"email":null,"service":null}.
Context: ${JSON.stringify(context)}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    return { enabled: true, ...parsed };
  } catch {
    return {
      enabled: true,
      reply: "Ich konnte das nicht eindeutig verstehen. Bitte wähle unten ein Datum und eine Uhrzeit aus.",
      action: "none",
    };
  }
}

module.exports = {
  parseBookingIntent,
  isEnabled: () => !!process.env.OPENAI_API_KEY,
};
