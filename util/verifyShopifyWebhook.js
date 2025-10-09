const crypto = require("crypto");

const prisma = require("../prisma/client");

const { decrypt } = require("../lib/crypto");

async function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const shopDomain = req.get("X-Shopify-Shop-Domain");

  if (!hmacHeader || !shopDomain) return res.status(401).send("Unauthorized");

  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store || !store.apiSecret) return res.status(401).send("Unauthorized");

  const secret = decrypt(store.apiSecret);

  try {
    const generatedHash = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("base64");

    const isValid = crypto.timingSafeEqual(
      Buffer.from(generatedHash, "base64"),
      Buffer.from(hmacHeader, "base64")
    );

    if (!isValid) return res.status(401).send("Unauthorized");

    req.body = JSON.parse(req.body.toString("utf8"));
    req.store = store; // <-- pass store to next middleware
    next();
  } catch (err) {
    console.error("❌ HMAC verification failed:", err);
    return res.status(401).send("Unauthorized");
  }
}

module.exports = { verifyShopifyWebhook };
