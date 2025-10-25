const express = require("express");
const {
  listOrders,
  getOrderDetails,
  updateOrderItemStatus,
} = require("../controllers/orders.controller");

const router = express.Router();

router.get("/", listOrders);

router.get("/:id", getOrderDetails);

router.patch("/orderItems/:orderItemId/status", updateOrderItemStatus);

module.exports = router;
