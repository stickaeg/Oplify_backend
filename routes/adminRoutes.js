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
  listVariantTitlesByProductType,
} = require("../controllers/productTypeRule.controllers");

const {
  createBatch,
  updateBatchRules,
  getBatchRules,
} = require("../controllers/batches.controllers");

// Dashboard Controllers
const {
  getTotalOrders,
  getTotalProductTypesSold,
  getReturnedItems,
} = require("../controllers/dashboard.controllers");

const { attachStoreScope } = require("../middleware/AuthMiddlewares");

// MainStock Controllers
const {
  createMainStock,
  listMainStock,
  getMainStockById,
  updateMainStock,
  deleteMainStock,

  listProductQuantities,
  assignProductQuantity,
  deleteProductQuantity,
  getProductsByMainStock,
} = require("../controllers/mainStock.controllers");

// ----- Store Management -----
router.post("/stores", addStore); // POST /admin/stores

// ----- Product Type Rules -----
router.post("/rules", createRule); // POST /admin/rules
router.put("/rules/:id", updateRule); // PUT /admin/rules/:id
router.get("/rules", listRules); // GET /admin/rules
router.get("/rules/store/:storeName", listProductTypesByStore);
router.get(
  "/rules/:storeName/:productType/variantTitles",
  listVariantTitlesByProductType
);
router.delete("/rules/:id", deleteRule);

// ----- Batches -----
router.post("/batches", createBatch);

router.patch("/batches/:batchId/rules", updateBatchRules);

router.get("/batches/:batchId/rules", getBatchRules);

// ----- MainStock -----
router.post("/mainStock", createMainStock); // Create new main stock
router.get("/mainStock", attachStoreScope, listMainStock); // List all main stock
router.get("/mainStock/:id", getMainStockById); // Get single main stock by ID
router.put("/mainStock/:id", updateMainStock); // Update main stock
router.delete("/mainStock/:id", deleteMainStock); // Delete main stock

// Assign quantity for a SKU to a main stock
router.post("/mainStock/:mainStockId/assign", assignProductQuantity);

// List all product quantities under a main stock (admin)
router.get("/mainStock/:mainStockId/quantities", listProductQuantities);

// Delete a single SKU quantity
router.delete("/mainStock/:mainStockId/sku/:sku", deleteProductQuantity);

router.get("/mainStock/:mainStockId/products", getProductsByMainStock);

// ----- Dashboard Endpoints -----
router.get("/dashboard/totalOrders", attachStoreScope, getTotalOrders);

router.get("/dashboard/returnedItems", attachStoreScope, getReturnedItems);

router.get(
  "/dashboard/totalProductTypesSold",
  attachStoreScope,
  getTotalProductTypesSold
);

module.exports = router;
