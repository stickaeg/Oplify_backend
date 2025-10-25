const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");
const prisma = require("../prisma/client");

async function listOrders(req, res) {
  try {
    const {
      page = 1,
      limit = 20,
      storeId,
      status,
      search,
      startDate,
      endDate,
    } = req.query;

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
      if (storeId) where.storeId = storeId;
    }

    // Optional status filter
    if (status) {
      where.status = status;
    }

    // ✅ Optional date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        // Include all orders up to end of day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // ✅ Optional search filter (by order number only)
    if (search) {
      const orderNumber = parseInt(search.trim());
      if (!isNaN(orderNumber)) {
        where.orderNumber = orderNumber;
      } else {
        // Invalid search (not a number) → return empty result
        return res.json({
          page: parseInt(page),
          limit: take,
          total: 0,
          pages: 0,
          data: [],
        });
      }
    }

    // Fetch data + total count
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

async function updateOrderItemStatus(req, res) {
  try {
    const { orderItemId } = req.params;
    const { status } = req.body;

    const validStatuses = [
      "PENDING",
      "WAITING_BATCH",
      "BATCHED",
      "DESIGNING",
      "DESIGNED",
      "PRINTING",
      "PRINTED",
      "CUTTING",
      "CUT",
      "FULFILLMENT",
      "PACKED",
      "COMPLETED",
      "CANCELLED",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    // ✅ Check if orderItem exists
    const orderItem = await prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: true,
        BatchItem: { include: { units: true, batch: true } },
      },
    });

    if (!orderItem) {
      return res.status(404).json({ message: "Order item not found" });
    }

    // ✅ Start transaction for atomic updates
    const updated = await prisma.$transaction(async (tx) => {
      // Update the order item status
      const updatedItem = await tx.orderItem.update({
        where: { id: orderItemId },
        data: { status },
      });

      // If item has batch links, update related batch records
      if (orderItem.BatchItem.length > 0) {
        const batchItemIds = orderItem.BatchItem.map((bi) => bi.id);

        await tx.batchItem.updateMany({
          where: { id: { in: batchItemIds } },
          data: { status },
        });

        await tx.batchItemUnit.updateMany({
          where: { batchItemId: { in: batchItemIds } },
          data: { status },
        });

        // Optionally: if all items in a batch reach same status → update the batch itself
        const batchIds = [
          ...new Set(orderItem.BatchItem.map((bi) => bi.batchId)),
        ];

        for (const batchId of batchIds) {
          const allItems = await tx.batchItem.findMany({
            where: { batchId },
            select: { status: true },
          });

          const allSame = allItems.every((i) => i.status === status);
          if (allSame) {
            await tx.batch.update({
              where: { id: batchId },
              data: { status },
            });
          }
        }
      }

      // ✅ Update the parent order's overall status based on all items
      await updateOrderStatusFromItems(orderItem.orderId, tx);

      return updatedItem;
    });

    return res.status(200).json({
      message: `Order item status updated to ${status}`,
      orderItem: updated,
    });
  } catch (err) {
    console.error("❌ Error updating order item status:", err);
    return res.status(500).json({
      message: "Failed to update order item status",
      error: err.message,
    });
  }
}

module.exports = { listOrders, getOrderDetails, updateOrderItemStatus };
