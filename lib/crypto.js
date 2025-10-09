const crypto = require("crypto");
const KEY = crypto
  .createHash("sha256")
  .update(String(process.env.ENCRYPTION_KEY))
  .digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12); // 96-bit iv
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // store as base64 json string: { iv, tag, data }
  return Buffer.from(
    JSON.stringify({
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: enc.toString("base64"),
    })
  ).toString("base64");
}

function decrypt(b64) {
  if (!b64) return null;
  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const iv = Buffer.from(json.iv, "base64");
  const tag = Buffer.from(json.tag, "base64");
  const data = Buffer.from(json.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
