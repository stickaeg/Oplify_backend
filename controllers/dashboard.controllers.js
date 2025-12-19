// controllers/dashboard.controllers.js
const prisma = require("../prisma/client");

/**
 * GET /admin/dashboard/total-orders
 *
 * Default:
 *   - Counts only COMPLETED orders
 *
 * Optional query params:
 *   - storeId    → filter by store
 *   - startDate  → ISO date string (YYYY-MM-DD)
 *   - endDate    → ISO date string (YYYY-MM-DD)
 */
async function getTotalOrders(req, res, next) {
  try {
    const { storeId, startDate, endDate } = req.query;

    // Base filter: only FULFILLED orders
    const where = {
      status: "FULFILLED",
    };

    // Apply storeId from middleware (USER) or from admin query
    if (req.storeId) {
      where.storeId = req.storeId;
    }

    // Optional: filter by createdAt date range
    const createdAtFilter = {};

    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start)) {
        createdAtFilter.gte = start;
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end)) {
        createdAtFilter.lte = end;
      }
    }

    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }

    const totalOrders = await prisma.order.count({ where });

    return res.json({ totalOrders });
  } catch (error) {
    console.error("Error in getTotalOrders:", error);
    return next(error);
  }
}

/**
 * GET /admin/dashboard/total-product-types-sold
 *
 * Default:
 *   - Uses ONLY items from COMPLETED orders
 *
 * Optional query params:
 *   - storeId    → filter by store (via order.storeId)
 *   - startDate  → filter by order.createdAt >= startDate
 *   - endDate    → filter by order.createdAt <= endDate
 *
 * Response:
 *   - totalsByProductType: { [productType]: totalQuantitySold }
 *   - totalQuantitySold: number
 *   - distinctProductTypesSold: number
 */
async function getTotalProductTypesSold(req, res, next) {
  try {
    const { startDate, endDate } = req.query;

    // Build order-level filter: only COMPLETED orders, plus optional store & date
    const orderFilter = {
      status: "FULFILLED",
    };

    // Apply storeId coming from middleware (USER or ADMIN)
    if (req.storeId) {
      orderFilter.storeId = req.storeId;
    }

    // Date filtering
    const createdAtFilter = {};

    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start)) {
        createdAtFilter.gte = start;
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end)) {
        createdAtFilter.lte = end;
      }
    }

    if (Object.keys(createdAtFilter).length > 0) {
      orderFilter.createdAt = createdAtFilter;
    }

    // OrderItem where filter via relation
    const orderItemWhere = {
      order: orderFilter,
    };

    // Grouping logic
    const groupedItems = await prisma.orderItem.groupBy({
      by: ["productId"],
      where: orderItemWhere,
      _sum: { quantity: true },
    });

    if (groupedItems.length === 0) {
      return res.json({
        totalsByProductType: {},
        totalQuantitySold: 0,
        distinctProductTypesSold: 0,
      });
    }

    const productIds = groupedItems.map((g) => g.productId);

    // Fetch product types
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, productType: true },
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

    return res.json({
      totalsByProductType,
      totalQuantitySold,
      distinctProductTypesSold: Object.keys(totalsByProductType).length,
    });
  } catch (error) {
    console.error("Error in getTotalProductTypesSold:", error);
    return next(error);
  }
}

async function getReturnedItems(req, res, next) {
  try {
    const {
      startDate,
      endDate,
      storeId: queryStoreId,
      productType,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(limit, 10) || 20, 1);

    // base where for ReturnedItem
    const where = {};

    // store scoping: USER -> own store, ADMIN -> optional filter, or all
    if (req.storeId) {
      // USER or ADMIN with attachStoreScope
      where.storeId = req.storeId;
    } else if (queryStoreId) {
      // in case you want explicit storeId for admin when attachStoreScope
      // sets req.storeId = null
      where.storeId = queryStoreId;
    }

    // optional date range on createdAt
    const createdAtFilter = {};

    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start)) {
        createdAtFilter.gte = start;
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end)) {
        createdAtFilter.lte = end;
      }
    }

    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }

    // filter by productType via relation
    if (productType) {
      where.product = {
        // relation filter
        productType: {
          equals: productType,
          mode: "insensitive",
        },
      };
    }

    const skip = (pageNumber - 1) * pageSize;

    const [returnedItems, total] = await prisma.$transaction([
      prisma.returnedItem.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          store: {
            select: {
              id: true,
              name: true,
              shopDomain: true,
            },
          },
          product: {
            select: { id: true, title: true, imgUrl: true, productType: true },
          },
          variant: {
            select: { id: true, title: true, sku: true },
          },
          order: {
            select: {
              id: true,
              orderNumber: true,
              customerName: true,
              storeId: true,
            },
          },
        },
      }),
      prisma.returnedItem.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize) || 1;

    return res.json({
      data: returnedItems,
      pagination: {
        total,
        page: pageNumber,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error in getReturnedItems:", error);
    return next(error);
  }
}

module.exports = {
  getTotalOrders,
  getTotalProductTypesSold,
  getReturnedItems,
};
