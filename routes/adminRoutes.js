const express = require("express");
const router = express.Router();

// Controllers
const { addStore } = require("../controllers/store.controllers");

const {
  createRule,
  updateRule,
  listRules,
  deleteRule,
  listProductTypesByStore,
} = require("../controllers/productTypeRule.controllers");
const { createBatch } = require("../controllers/batches.controllers");

// ----- Store Management -----
router.post("/stores", addStore); // POST /admin/stores

// ----- Product Type Rules -----
router.post("/rules", createRule); // POST /admin/rules

router.put("/rules/:id", updateRule); // PUT /admin/rules/:id

router.get("/rules", listRules); // GET /admin/rules

router.get("/rules/store/:storeName", listProductTypesByStore);

router.delete("/rules/:id", deleteRule); // DELETE /admin/rules/:id

router.post("/batches", createBatch);

module.exports = router;
