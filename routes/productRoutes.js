const express = require("express");
const { listProducts } = require("../controllers/product.controller");

const router = express.Router();

router.get("/", listProducts);

module.exports = router;
