const express = require("express");
const router = express.Router();

const {
  listBatches,
  updateBatchStatus,
  getBatchById,
} = require("../controllers/batches.controllers");

router.get("/", listBatches);

router.get("/:batchId", getBatchById);

router.patch("/:batchId/status", updateBatchStatus);

module.exports = router;
