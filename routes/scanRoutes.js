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
  const order = await prisma.order.findUnique({
    where: { id: req.params.orderId },
    include: { store: true },
  });

  try {
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
