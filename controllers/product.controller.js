const prisma = require("../prisma/client");

async function listProducts(req, res) {
  try {
    const { page = 1, limit = 20, storeId, productType, isPod } = req.query;

    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    let where = {};

    // 🧩 Role-based access control
    if (req.session.role === "USER") {
      if (!req.session.storeId) {
        return res
          .status(403)
          .json({ error: "No store assigned to this user" });
      }
      where.storeId = req.session.storeId;
    } else {
      if (storeId) where.storeId = storeId;
    }

    // 🧠 Optional product type filter
    if (productType) {
      // case-insensitive partial match
      where.productType = { contains: productType, mode: "insensitive" };
    }

    // 🎯 Optional isPod filter (true/false)
    if (typeof isPod !== "undefined") {
      // convert query string ("true"/"false") to boolean
      where.isPod = isPod === "true";
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          store: { select: { id: true, name: true, shopDomain: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return res.json({
      page: parseInt(page),
      limit: take,
      total,
      pages: Math.ceil(total / take),
      data: products,
    });
  } catch (err) {
    console.error("Error listing products:", err);
    return res.status(500).send("server error");
  }
}

module.exports = { listProducts };
