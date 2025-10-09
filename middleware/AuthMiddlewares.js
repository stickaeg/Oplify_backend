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

module.exports = { authWithRefresh, requireRole };
