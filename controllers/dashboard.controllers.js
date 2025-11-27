// controllers/dashboard.controllers.js
const prisma = require("../prisma/client");

/**
 * GET /admin/dashboard/total-orders
 * Returns the total number of orders (optionally filtered by storeId)
 */
async function getTotalOrders(req, res, next) {
  try {
    const { storeId } = req.query;

    const where = storeId ? { storeId } : {};

    const totalOrders = await prisma.order.count({
      where,
    });

    return res.json({
      totalOrders,
    });
  } catch (error) {
    console.error("Error in getTotalOrders:", error);
    return next(error);
  }
}

/**
 * GET /admin/dashboard/total-product-types-sold
 * Returns:
 *  - totalsByProductType: { [productType]: totalQuantitySold }
 *  - totalQuantitySold: sum of all quantities
 *  - distinctProductTypesSold: number of types that have at least one sale
 *
 * Optional query: ?storeId=...
 */
async function getTotalProductTypesSold(req, res, next) {
  try {
    const { storeId } = req.query;

    // Build WHERE for order items (optionally filter by store)
    const orderItemWhere = storeId
      ? {
          order: {
            storeId,
          },
        }
      : {};

    // Group order items by productId and sum quantities
    const groupedItems = await prisma.orderItem.groupBy({
      by: ["productId"],
      where: orderItemWhere,
      _sum: {
        quantity: true,
      },
    });

    if (groupedItems.length === 0) {
      return res.json({
        totalsByProductType: {},
        totalQuantitySold: 0,
        distinctProductTypesSold: 0,
      });
    }

    const productIds = groupedItems.map((g) => g.productId);

    // Fetch productType for each product
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        productType: true,
      },
    });

    const productTypeById = new Map(
      products.map((p) => [p.id, p.productType || "UNKNOWN"])
    );

    const totalsByProductType = {};
    let totalQuantitySold = 0;

    for (const group of groupedItems) {
      const type = productTypeById.get(group.productId) || "UNKNOWN";
      const qty = group._sum.quantity || 0;

      totalQuantitySold += qty;
      totalsByProductType[type] = (totalsByProductType[type] || 0) + qty;
    }

    const distinctProductTypesSold = Object.keys(totalsByProductType).length;

    return res.json({
      totalsByProductType,
      totalQuantitySold,
      distinctProductTypesSold,
    });
  } catch (error) {
    console.error("Error in getTotalProductTypesSold:", error);
    return next(error);
  }
}

module.exports = {
  getTotalOrders,
  getTotalProductTypesSold,
};
