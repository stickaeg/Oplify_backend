const express = require("express");
const {
  listOrders,
  getOrderDetails,
} = require("../controllers/orders.controller");

const router = express.Router();

router.get("/", listOrders);

router.get("/:id", getOrderDetails);

module.exports = router;
