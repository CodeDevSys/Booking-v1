const { randomUUID } = require("crypto");

function createWhatsAppDemoNotification({ entry, offer, message }) {
  return {
    id: randomUUID(),
    offerId: offer.id,
    entryId: entry.id,
    token: offer.token,
    channel: "whatsapp-demo",
    customerName: entry.name,
    to: entry.phone,
    message,
    actionLabel: "Termin übernehmen",
    declineLabel: "Nein danke",
    status: "delivered",
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  createWhatsAppDemoNotification,
};
