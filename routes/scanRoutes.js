// routes/scan.routes.js
const express = require("express");
const router = express.Router();
const {
  scanBatch,
  scanUnitFulfillment,
} = require("../controllers/scan.controllers");

// Batch QR scan (Printer)
router.get("/batch/:token", scanBatch);

// Item QR scan (Fulfillment)
router.get("/item-fulfillment/:token", scanUnitFulfillment);

module.exports = router;
