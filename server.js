require("dotenv").config();

const express = require("express");
const cookieSession = require("cookie-session");
const cors = require("cors");
const compression = require("compression");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const storeRoutes = require("./routes/storeRoutes");
const productRoutes = require("./routes/productRoutes");
const ordersRoutes = require("./routes/ordersRoutes");
const batchesRoutes = require("./routes/batchesRoutes");
const webhooksRoutes = require("./routes/webhooksRoutes");
const googleRoutes = require("./routes/googleRoutes");
const scanRoutes = require("./routes/scanRoutes");

const {
  authWithRefresh,
  requireRole,
} = require("./middleware/AuthMiddlewares");

const app = express();

// app.set("trust proxy", 1);

app.use(
  compression({
    level: 6, // compression level (0–9)
    threshold: 1024, // only compress responses > 1KB
  })
);
// Webhook verification middleware

app.use("/webhooks", webhooksRoutes);

// NOW apply other middleware (after webhooks are handled)
app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: false,
    sameSite: "strict",
  })
);

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());

app.use("/api/auth", authRoutes);

app.use(authWithRefresh);

app.use("/api/stores", storeRoutes);

app.use("/api/products", productRoutes);

app.use("/api/batches", batchesRoutes);

app.use("/api/orders", ordersRoutes);

app.use("/api/scan", scanRoutes);

app.use("/api/google", googleRoutes);

app.use("/api/admin", requireRole("ADMIN"), adminRoutes);

const PORT = process.env.PORT;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
