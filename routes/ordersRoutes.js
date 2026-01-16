const express = require("express");
const {
  listOrders,
  getOrderDetails,
  updateOrderItemStatus,
  replaceUnit,
  bulkUpdateOrderItemsStatus,
} = require("../controllers/orders.controller");
const { attachStoreScope } = require("../middleware/AuthMiddlewares");

const router = express.Router();

router.get("/", attachStoreScope, listOrders);

router.get("/:id", attachStoreScope, getOrderDetails);

router.patch("/orderItems/:orderItemId/status", updateOrderItemStatus);

router.post("/items/:orderId/bulk-status", bulkUpdateOrderItemsStatus);

router.patch("/units/:unitId/replace", replaceUnit);

module.exports = router;
