const express = require("express");
const router = express.Router();

const {
  listBatches,
  updateBatchStatus,
  getBatchById,
} = require("../controllers/batches.controllers");
const { listRules } = require("../controllers/productTypeRule.controllers");

router.get("/", listBatches);

router.get("/rules", listRules); 

router.get("/:batchId", getBatchById);

router.patch("/:batchId/status", updateBatchStatus);

module.exports = router;
