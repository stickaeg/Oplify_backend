const express = require("express");
const {
  listOrders,
  getOrderDetails,
  updateOrderItemStatus,
  replaceUnit,
} = require("../controllers/orders.controller");
const { attachStoreScope } = require("../middleware/AuthMiddlewares");

const router = express.Router();

router.get("/", attachStoreScope, listOrders);

router.get("/:id", attachStoreScope, getOrderDetails);

router.patch("/orderItems/:orderItemId/status", updateOrderItemStatus);

router.patch("/units/:unitId/replace", replaceUnit);

module.exports = router;
