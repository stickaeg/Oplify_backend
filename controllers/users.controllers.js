const prisma = require("../prisma/client");

const bcrypt = require("bcrypt");

// 🔹 REGISTER
async function createUser(req, res) {
  try {
    const { name, password, role, secret, storeName } = req.body;

    if (!name || !password || !secret) {
      return res
        .status(400)
        .json({ error: "Name, password, and secret are required" });
    }

    // Check secret
    if (secret !== process.env.REGISTER_SECRET) {
      return res.status(403).json({ error: "Invalid registration secret" });
    }

    const existingUser = await prisma.user.findUnique({ where: { name } });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    let resolvedStoreId = null;
    if (role === "USER") {
      if (!storeName) {
        return res
          .status(400)
          .json({ error: "storeName required for USER role" });
      }

      const store = await prisma.store.findUnique({
        where: { name: storeName },
      });

      if (!store) return res.status(400).json({ error: "Invalid storeName" });

      resolvedStoreId = store.id;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        password: hashedPassword,
        role,
        storeId: resolvedStoreId, // null for non-USER roles
      },
    });

    // Set session
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.storeId = user.storeId || null;

    res.status(201).json({
      message: "User registered",
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

// 🔹 LOGIN
async function loginUser(req, res) {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { name } });
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Set session
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.storeId = user.storeId || null;

    return res.json({
      message: "Logged in",
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        storeName: user.storeId,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}

// 🔹 LOGOUT
async function logoutUser(req, res) {
  req.session = null;
  return res.json({ message: "Logged out" });
}

// 🔹 CURRENT USER CHEC
async function getCurrentUser(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, name: true, role: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("getCurrentUser error:", err);
    res.status(500).json({ error: "Server error" });
  }
}



module.exports = {
  createUser,
  loginUser,
  logoutUser,
  getCurrentUser,
};
