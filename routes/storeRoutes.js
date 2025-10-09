const express = require("express");
const { listStores } = require("../controllers/store.controllers");

const router = express.Router();

router.get("/", listStores);

module.exports = router;
