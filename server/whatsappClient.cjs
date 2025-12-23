// whatsappClient.cjs
"use strict";

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");

let isReady = false;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "wave-whatsapp", // persists session in .wwebjs_auth
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

console.log("[WhatsApp] Module loaded, initializing client...");

client.on("qr", (qr) => {
  console.log("===========================================");
  console.log("[WhatsApp] Scan this QR with the company phone:");
  console.log("WhatsApp → Linked devices → Link a device");
  console.log("===========================================");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  isReady = true;
  console.log("[WhatsApp] Client is ready and logged in.");
});

client.on("authenticated", () => {
  console.log("[WhatsApp] Authenticated.");
});

client.on("auth_failure", (msg) => {
  console.error("[WhatsApp] Auth failure:", msg);
});

client.on("disconnected", (reason) => {
  isReady = false;
  console.warn("[WhatsApp] Disconnected:", reason);
});

// Initialize immediately when this module is loaded
client.initialize();

/**
 * LOW-LEVEL: send plain text only.
 * @param {string} toNumberE164 - e.g. "+919876543210"
 * @param {string} message
 */
async function sendWhatsAppText(toNumberE164, message) {
  if (!isReady) {
    console.warn("[WhatsApp] Client not ready. Skipping send to", toNumberE164);
    return;
  }

  if (!toNumberE164) {
    console.warn("[WhatsApp] Empty phone number, skipping");
    return;
  }

  const jid = toNumberE164.replace("+", "").trim() + "@c.us";

  try {
    await client.sendMessage(jid, message);
    console.log(`[WhatsApp] Text message sent to ${toNumberE164}`);
  } catch (err) {
    console.error(
      `[WhatsApp] Failed to send text to ${toNumberE164}:`,
      err && err.message ? err.message : err
    );
  }
}

/**
 * Send text + QR image (PNG) in one flow.
 * - Sends the text message first.
 * - Then sends a QR image (generated from qrPayload) with a short caption.
 *
 * @param {string} toNumberE164 - e.g. "+919876543210"
 * @param {string} message - main text body
 * @param {string} qrPayload - the string encoded in the QR (what you store as Guests.qrCode)
 * @param {string} [labelForFilename] - used for image filename, optional
 */
async function sendWhatsAppTextWithQr(
  toNumberE164,
  message,
  qrPayload,
  labelForFilename
) {
  if (!isReady) {
    console.warn("[WhatsApp] Client not ready. Skipping send to", toNumberE164);
    return;
  }

  if (!toNumberE164) {
    console.warn("[WhatsApp] Empty phone number, skipping");
    return;
  }

  const jid = toNumberE164.replace("+", "").trim() + "@c.us";

  try {
    // 1) Send the main text message
    if (message) {
      await client.sendMessage(jid, message);
    }

    // 2) If we have a QR payload, generate an image and send it
    if (qrPayload) {
      // Create a PNG data URL for the QR code
      const dataUrl = await QRCode.toDataURL(qrPayload, {
        type: "image/png",
        margin: 1,
        scale: 4,
      });

      const base64 = dataUrl.split(",")[1]; // strip "data:image/png;base64,"

      const safeLabel = (labelForFilename || "visitor-qr").replace(
        /[^a-z0-9_\-]/gi,
        "_"
      );

      const media = new MessageMedia("image/png", base64, `${safeLabel}.png`);

      const caption = "Visitor QR – please show this at the security gate.";

      await client.sendMessage(jid, media, { caption });

      console.log(
        `[WhatsApp] Text + QR image sent to ${toNumberE164} (payload length: ${qrPayload.length})`
      );
    } else {
      console.log(
        `[WhatsApp] Text sent to ${toNumberE164} (no QR payload provided)`
      );
    }
  } catch (err) {
    console.error(
      `[WhatsApp] Failed to send text+QR to ${toNumberE164}:`,
      err && err.message ? err.message : err
    );
  }
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppTextWithQr,
};
