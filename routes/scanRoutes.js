// routes/scan.routes.js
const express = require("express");
const router = express.Router();
const {
  scanBatch,
  scanItemCutter,
  scanItemFulfillment,
} = require("../controllers/scan.controllers");

// Batch QR scan (Printer)
router.get("/batch/:token", scanBatch);

// Item QR scan (Cutter)
router.get("/item/:token", scanItemCutter);

// Item QR scan (Fulfillment)
router.get("/item-fulfillment/:token", scanItemFulfillment);

module.exports = router;
