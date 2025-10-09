const express = require("express");

const {
  createUser,
  loginUser,
  logoutUser,
  getCurrentUser,
} = require("../controllers/users.controllers");

const router = express.Router();

router.post("/register", createUser);

router.post("/login", loginUser);

router.post("/logout", logoutUser);

router.get("/me", getCurrentUser);

module.exports = router;
