const express = require("express");
const {
  handleProductUpdate,
  handleProductCreate,
  handleProductDelete,
  handleOrderCreate,
} = require("../controllers/webhook.controller");
const { verifyShopifyWebhook } = require("../util/verifyShopifyWebhook");
const router = express.Router();

router.post(
  "/products/create",
  express.raw({ type: "application/json" }),
  verifyShopifyWebhook,
  handleProductCreate
);

router.post(
  "/products/update",
  express.raw({ type: "application/json" }),
  verifyShopifyWebhook,
  handleProductUpdate
);

router.post(
  "/products/delete",
  express.raw({ type: "application/json" }),
  verifyShopifyWebhook,
  handleProductDelete
);

router.post(
  "/orders/create",
  express.raw({ type: "*/*" }), // <-- use wildcard to always get raw
  verifyShopifyWebhook,
  handleOrderCreate
);

module.exports = router;
