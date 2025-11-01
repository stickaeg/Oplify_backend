// routes/scan.routes.js
const express = require("express");
const router = express.Router();
const {
  scanBatch,
  scanUnitFulfillment,
} = require("../controllers/scan.controllers");
const prisma = require("../prisma/client");
const { fulfillOrder } = require("../services/shopifyServices");
const { decrypt } = require("../lib/crypto");

// Batch QR scan (Printer)
router.get("/batch/:token", scanBatch);

// Item QR scan (Fulfillment)
router.get("/item-fulfillment/:token", scanUnitFulfillment);

router.post("/manualFulfill/:orderId", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { store: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!order.store) {
      return res.status(400).json({ error: "Store not found for order" });
    }

    // ✅ DECRYPT the access token
    const decryptedToken = decrypt(order.store.accessToken);

    if (!order.store.shopDomain || !decryptedToken || !order.shopifyId) {
      return res.status(400).json({
        error: "Missing required store or order data",
      });
    }

    // ✅ Use decrypted token
    await fulfillOrder(
      order.store.shopDomain,
      decryptedToken, // ← Decrypted!
      order.shopifyId
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
