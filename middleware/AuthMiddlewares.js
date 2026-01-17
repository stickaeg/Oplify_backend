const sessionRefresh = require("./SessionRefresh");

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function requireRole(roles) {
  if (!Array.isArray(roles)) roles = [roles];

  return (req, res, next) => {
    if (!req.session.role || !roles.includes(req.session.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function authWithRefresh(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    sessionRefresh(req, res, next);
  });
}

function attachStoreScope(req, res, next) {
  const role = req.session.role;
  const userStoreId = req.session.storeId;
  const queryStoreId = req.query.storeId;

  if (role === "USER") {
    if (!userStoreId) {
      return res.status(403).json({ error: "Store not assigned to this user" });
    }

    // Force user store, ignore query storeId
    req.storeId = userStoreId;
    return next();
  }

  // ADMIN: allow storeId from query, optional
  if (
    role === "ADMIN" ||
    role === "PRINTER" ||
    role === "CUTTER" ||
    role === "FULLFILLMENT" ||
    role === "DESIGNER"
  ) {
    req.storeId = queryStoreId || null; // admin can filter or get all
    return next();
  }

  // fallback if role not supported
  return res.status(403).json({ error: "Unauthorized role" });
}

module.exports = { authWithRefresh, requireRole, attachStoreScope };
