// routes/scan.routes.js
const express = require("express");
const router = express.Router();
const {
  scanBatch,
  scanUnitFulfillment,
} = require("../controllers/scan.controllers");
const prisma = require("../prisma/client");
const { fulfillOrder } = require("../services/shopifyServices");

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

    // ✅ Check if order exists
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // ✅ Check if store exists
    if (!order.store) {
      return res.status(400).json({ error: "Store not found for order" });
    }

    // ✅ Check if required fields exist
    if (
      !order.store.shopDomain ||
      !order.store.accessToken ||
      !order.shopifyId
    ) {
      return res.status(400).json({
        error: "Missing required store or order data",
        details: {
          shopDomain: !!order.store.shopDomain,
          accessToken: !!order.store.accessToken,
          shopifyId: !!order.shopifyId,
        },
      });
    }

    // ✅ Now safe to fulfill
    await fulfillOrder(
      order.store.shopDomain,
      order.store.accessToken,
      order.shopifyId
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
