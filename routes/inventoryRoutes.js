const express = require("express");
const router = express.Router();

const stockController = require("../controllers/inventory.controllers");

// StockItem routes
router.post("/stock-items", stockController.createStockItem);
router.get("/stock-items", stockController.getStockItems);
router.get("/stock-items/:id", stockController.getStockItemById);
router.put("/stock-items/:id", stockController.updateStockItem);
router.delete("/stock-items/:id", stockController.deleteStockItem);

// StockVariant routes
router.post("/stock-variants", stockController.createStockVariant);
router.get("/stock-variants", stockController.getStockVariants);
router.get("/stock-variants/:id", stockController.getStockVariantById);
router.put("/stock-variants/:id", stockController.updateStockVariant);
router.delete("/stock-variants/:id", stockController.deleteStockVariant);

module.exports = router;
