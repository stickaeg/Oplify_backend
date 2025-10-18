const prisma = require("../prisma/client");

async function listOrders(req, res) {async function listOrders(req, res) {
  try {
    const { page = 1, limit = 20, storeId, status, search } = req.query;

    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    let where = {};

    // Role-based filtering
    if (req.session.role === "USER") {
      if (!req.session.storeId) {
        return res.status(403).json({ error: "No store assigned to this user" });
      }
      where.storeId = req.session.storeId;
    } else {
      // ADMIN and other roles can filter optionally
      if (storeId) where.storeId = storeId;
    }

    // Optional status filter
    if (status) {
      where.status = status;
    }

    // Optional search filter
    if (search) {
      const searchTerm = search.trim();
      where.OR = [
        { customerName: { contains: searchTerm, mode: "insensitive" } },
        { customerEmail: { contains: searchTerm, mode: "insensitive" } },
        { orderNumber: { contains: searchTerm, mode: "insensitive" } },
        { shopifyId: { contains: searchTerm, mode: "insensitive" } },
        {
          store: {
            name: { contains: searchTerm, mode: "insensitive" },
          },
        },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          shopifyId: true,
          orderNumber: true,
          storeId: true,
          customerName: true,
          customerEmail: true,
          totalPrice: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  imgUrl: true,
                  productType: true,
                },
              },
              variant: {
                select: {
                  id: true,
                  sku: true,
                  title: true,
                  price: true,
                },
              },
            },
          },
          store: {
            select: { id: true, name: true, shopDomain: true },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return res.json({
      page: parseInt(page),
      limit: take,
      total,
      pages: Math.ceil(total / take),
      data: orders,
    });
  } catch (err) {
    console.error("Error listing orders:", err);
    return res.status(500).send("Server error");
  }
}

  try {
    const { page = 1, limit = 20, storeId, status } = req.query;

    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    let where = {};

    // Role-based filtering
    if (req.session.role === "USER") {
      if (!req.session.storeId) {
        return res
          .status(403)
          .json({ error: "No store assigned to this user" });
      }
      where.storeId = req.session.storeId;
    } else {
      // ADMIN and other roles can filter optionally
      if (storeId) where.storeId = storeId;
    }

    // Optional status filter
    if (status) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          shopifyId: true,
          orderNumber: true,
          storeId: true,
          customerName: true,
          customerEmail: true,
          totalPrice: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  imgUrl: true,
                  productType: true,
                },
              },
              variant: {
                select: {
                  id: true,
                  sku: true,
                  title: true,
                  price: true,
                },
              },
            },
          },
          store: {
            select: { id: true, name: true, shopDomain: true },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return res.json({
      page: parseInt(page),
      limit: take,
      total,
      pages: Math.ceil(total / take),
      data: orders,
    });
  } catch (err) {
    console.error("Error listing orders:", err);
    return res.status(500).send("Server error");
  }
}

async function getOrderDetails(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Order ID is required" });

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id }, { shopifyId: id }],
        ...(req.session.role === "USER" && req.session.storeId
          ? { storeId: req.session.storeId }
          : {}),
      },
      select: {
        id: true,
        shopifyId: true,
        orderNumber: true,
        storeId: true,
        customerName: true,
        customerEmail: true,
        totalPrice: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                imgUrl: true,
                productType: true,
                isPod: true,
              },
            },
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
                price: true,
              },
            },
            BatchItem: {
              include: {
                batch: {
                  select: {
                    id: true,
                    name: true,
                    capacity: true,
                    maxCapacity: true,
                    status: true,
                    createdAt: true,
                    rules: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
          },
        },
        store: {
          select: { id: true, name: true, shopDomain: true },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    // 🧠 Enhance order items with batch info and naming normalization
    const enhancedItems = order.items.map((item) => {
      if (!item.BatchItem?.length) {
        return {
          ...item,
          overallStatus: "WAITING_BATCH",
          batches: [],
        };
      }

      const batchProgress = item.BatchItem.map((bi) => {
        const batch = bi.batch;

        // 🧩 Normalize batch name for display (same pattern as in helper)
        let normalizedName = batch.name;
        if (!batch.name.includes("Batch #")) {
          // If admin's original name — treat as base for Batch #1
          normalizedName = `${batch.name} - Batch #1`;
        }

        return {
          batchId: batch.id,
          batchName: normalizedName,
          quantityAssigned: bi.quantity,
          status: batch.status,
          capacity: `${batch.capacity}/${batch.maxCapacity}`,
          rules: batch.rules.map((r) => r.name),
          progressNote: getProgressNote(batch.status, batch),
        };
      });

      const overallStatus = determineOverallStatus(batchProgress);

      return {
        ...item,
        batches: batchProgress,
        overallStatus,
      };
    });

    return res.json({
      ...order,
      items: enhancedItems,
    });
  } catch (err) {
    console.error("Error fetching order details:", err);
    return res.status(500).send("Server error");
  }
}

// 👇 Helper function to generate progress notes
function getProgressNote(status, batch) {
  const statusMessages = {
    PENDING: `Batch ${batch.name} is pending`,
    WAITING_BATCH: `Batch ${batch.name} is waiting - ${batch.capacity}/${batch.maxCapacity}`,
    BATCHED: `Batch ${batch.name} is full and batched`,
    DESIGNING: `Batch ${batch.name} is in design phase`,
    PRINTING: `Batch ${batch.name} is being printed`,
    CUTTING: `Batch ${batch.name} is being cut`,
    FULFILLMENT: `Batch ${batch.name} is in fulfillment`,
    COMPLETED: `Batch ${batch.name} is completed`,
    CANCELLED: `Batch ${batch.name} was cancelled`,
  };

  return statusMessages[status] || `Batch ${batch.name} - ${status}`;
}

// 👇 Helper function to determine overall status from multiple batches
function determineOverallStatus(batchProgress) {
  if (!batchProgress.length) return "WAITING_BATCH";

  // Get all unique statuses
  const statuses = batchProgress.map((b) => b.status);

  // If all batches have the same status, use that
  const uniqueStatuses = [...new Set(statuses)];
  if (uniqueStatuses.length === 1) {
    return uniqueStatuses[0];
  }

  // Priority order for mixed statuses (most advanced status wins)
  const statusPriority = [
    "COMPLETED",
    "FULFILLMENT",
    "CUTTING",
    "PRINTING",
    "DESIGNING",
    "BATCHED",
    "WAITING_BATCH",
    "PENDING",
    "CANCELLED",
  ];

  // Return the most advanced status
  for (const status of statusPriority) {
    if (statuses.includes(status)) {
      return status;
    }
  }

  return "WAITING_BATCH";
}
module.exports = { listOrders, getOrderDetails };
