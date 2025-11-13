const express = require("express");
const {
  listOrders,
  getOrderDetails,
  updateOrderItemStatus,
  replaceUnit,
} = require("../controllers/orders.controller");

const router = express.Router();

router.get("/", listOrders);

router.get("/:id", getOrderDetails);

router.patch("/orderItems/:orderItemId/status", updateOrderItemStatus);

router.patch("/units/:unitId/replace", replaceUnit);

module.exports = router;
