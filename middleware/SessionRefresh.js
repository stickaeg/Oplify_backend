function sessionRefresh(req, res, next) {
  if (req.session && req.session.userId) {
    // Refresh expiry by touching the session
    req.session.nowInMinutes = Math.floor(Date.now() / 60000);
  }
  next();
}

module.exports = sessionRefresh;
