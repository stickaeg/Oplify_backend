const { createReplacementUnit } = require("../helpers/batchHelper");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");
const prisma = require("../prisma/client");
const { adjustMainStock } = require("../util/mainStockHelper");
const { autoUpdateBatchStatus } = require("./batches.controllers");

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
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // ✅ Optional search filter (order number, phone, name, email)
    if (search) {
      const searchTerm = search.trim();

      if (!isNaN(searchTerm)) {
        const phoneVariants = [];

        // Handle Egyptian phone formats (010... and +2010...)
        if (searchTerm.startsWith("0")) {
          phoneVariants.push(searchTerm); // local
          phoneVariants.push("+2" + searchTerm); // +2010...
          phoneVariants.push("+20" + searchTerm.slice(1)); // +2010...
        } else if (searchTerm.startsWith("+20")) {
          phoneVariants.push(searchTerm); // +2010...
          phoneVariants.push("0" + searchTerm.slice(3)); // 010...
        } else if (searchTerm.startsWith("20")) {
          phoneVariants.push("+" + searchTerm); // +2010...
          phoneVariants.push("0" + searchTerm.slice(2)); // 010...
        }

        where.OR = [
          { orderNumber: parseInt(searchTerm) },
          ...phoneVariants.map((p) => ({
            customerPhone: { contains: p },
          })),
        ];
      } else {
        where.OR = [
          { customerName: { contains: searchTerm, mode: "insensitive" } },
          { customerEmail: { contains: searchTerm, mode: "insensitive" } },
        ];
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
          customerPhone: true,
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
        customerPhone: true,
        address1: true,
        address2: true,
        province: true,
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
                units: {
                  select: {
                    id: true,
                    status: true,
                    qrCodeUrl: true,
                    qrCodeToken: true,
                  },
                  orderBy: { id: "asc" }, // ✅ Add stable ordering by ID
                },
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
              orderBy: { id: "asc" }, // ✅ Also order BatchItems consistently
            },
          },
          orderBy: { id: "asc" }, // ✅ Order items consistently too
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

        // 🧩 Normalize batch name for display
        let normalizedName = batch.name;
        if (!batch.name.includes("Batch #")) {
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
    "RETURNED",
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
    const { status, unitIds } = req.body;

    const validStatuses = [
      "PENDING",
      "BATCHED",
      "WAITING_BATCH",
      "DESIGNING",
      "DESIGNED",
      "PRINTING",
      "PRINTED",
      "CUTTING",
      "CUT",
      "FULFILLMENT",
      "FULFILLED",
      "PACKED",
      "COMPLETED",
      "RETURNED",
      "CANCELLED",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

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

    await prisma.$transaction(async (tx) => {
      console.log("✅ STOCK PATH - updating item directly"); // 👈 ADD
      // 👇 NEW: STOCK orders (no BatchItem)
      if (!orderItem.BatchItem || orderItem.BatchItem.length === 0) {
        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { status },
        });

        // MainStock adjustment
        const updatedOrderItem = await tx.orderItem.findUnique({
          where: { id: orderItemId },
          include: {
            product: true,
            variant: true,
            order: { include: { store: true } },
          },
        });

        if (updatedOrderItem) {
          const finalStatus = updatedOrderItem.status;
          if (finalStatus === "FULFILLED") {
            await adjustMainStock(
              tx,
              updatedOrderItem.product.productType,
              updatedOrderItem.variant?.title,
              updatedOrderItem.order.storeId,
              updatedOrderItem.quantity,
              "decrement"
            );
          } else if (finalStatus === "RETURNED") {
            await adjustMainStock(
              tx,
              updatedOrderItem.product.productType,
              updatedOrderItem.variant?.title,
              updatedOrderItem.order.storeId,
              updatedOrderItem.quantity,
              "increment"
            );
          }
        }

        await updateOrderStatusFromItems(orderItem.orderId, tx);
        return; // 👈 EXIT EARLY - no batches to update
      }

      // 👇 EXISTING: POD orders with units/batches
      if (unitIds && Array.isArray(unitIds) && unitIds.length > 0) {
        // Partial fulfillment - update specific units
        await tx.batchItemUnit.updateMany({
          where: {
            id: { in: unitIds },
            batchItem: { orderItemId },
          },
          data: { status },
        });

        // Recalculate BatchItem statuses based on their units
        const affectedBatchItems = await tx.batchItem.findMany({
          where: { orderItemId },
          include: { units: true },
        });

        for (const batchItem of affectedBatchItems) {
          const unitStatuses = batchItem.units.map((u) => u.status);
          const derivedStatus = deriveStatusFromUnits(unitStatuses);

          await tx.batchItem.update({
            where: { id: batchItem.id },
            data: { status: derivedStatus },
          });
        }

        // Recalculate OrderItem status
        const allUnits = await tx.batchItemUnit.findMany({
          where: {
            batchItem: { orderItemId },
          },
          select: { status: true },
        });

        const orderItemStatus = deriveStatusFromUnits(
          allUnits.map((u) => u.status)
        );

        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { status: orderItemStatus },
        });
      } else {
        // Bulk update all units
        const batchItemIds = orderItem.BatchItem.map((bi) => bi.id);

        await tx.batchItemUnit.updateMany({
          where: { batchItemId: { in: batchItemIds } },
          data: { status },
        });

        await tx.batchItem.updateMany({
          where: { id: { in: batchItemIds } },
          data: { status },
        });

        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { status },
        });
      }

      // 👇 MainStock adjustment for POD orders (after status updates)
      const updatedOrderItem = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        include: {
          product: true,
          variant: true,
          order: { include: { store: true } },
        },
      });

      if (updatedOrderItem) {
        const finalStatus = updatedOrderItem.status;
        if (finalStatus === "FULFILLED") {
          await adjustMainStock(
            tx,
            updatedOrderItem.product.productType,
            updatedOrderItem.variant?.title,
            updatedOrderItem.order.storeId,
            updatedOrderItem.quantity,
            "decrement"
          );
        } else if (finalStatus === "RETURNED") {
          await adjustMainStock(
            tx,
            updatedOrderItem.product.productType,
            updatedOrderItem.variant?.title,
            updatedOrderItem.order.storeId,
            updatedOrderItem.quantity,
            "increment"
          );
        }
      }

      // Update batch statuses
      const batchIds = [
        ...new Set(orderItem.BatchItem.map((bi) => bi.batchId)),
      ];

      for (const batchId of batchIds) {
        const batchItems = await tx.batchItem.findMany({
          where: { batchId },
          include: { units: true },
        });

        const allUnitStatuses = batchItems.flatMap((bi) =>
          bi.units.map((u) => u.status)
        );

        const batchStatus = deriveStatusFromUnits(allUnitStatuses);

        await tx.batch.update({
          where: { id: batchId },
          data: { status: batchStatus },
        });
      }

      await updateOrderStatusFromItems(orderItem.orderId, tx);
    });

    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderItem.orderId },
      include: {
        store: { select: { id: true, name: true, shopDomain: true } },
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
            variant: { select: { id: true, title: true, sku: true } },
            BatchItem: {
              include: {
                units: { select: { id: true, status: true } },
                batch: { select: { id: true, name: true, status: true } },
              },
            },
          },
        },
      },
    });

    return res.status(200).json({
      message: `Order item status updated to ${status}`,
      order: updatedOrder,
    });
  } catch (err) {
    console.error("❌ Error updating order item status:", err);
    return res.status(500).json({
      message: "Failed to update order item status",
      error: err.message,
    });
  }
}

function deriveStatusFromUnits(statuses) {
  if (!statuses.length) return "WAITING_BATCH";

  const uniqueStatuses = [...new Set(statuses)];

  // If all units same status, return that
  if (uniqueStatuses.length === 1) {
    return uniqueStatuses[0];
  }

  // Priority: most advanced status wins
  const statusPriority = [
    "COMPLETED",
    "BATCHED",
    "PACKED",
    "FULFILLMENT",
    "DESIGNING",
    "CUT",
    "CUTTING",
    "PRINTED",
    "PRINTING",
    "DESIGNED",
    "WAITING_BATCH",
    "PENDING",
    "RETURNED",
    "CANCELLED",
  ];

  for (const status of statusPriority) {
    if (statuses.includes(status)) return status;
  }

  return "WAITING_BATCH";
}

async function replaceUnit(req, res) {
  try {
    const { unitId } = req.params;
    const { reason } = req.body; // "REDESIGN" or "REPRINT"

    if (!["REDESIGN", "REPRINT"].includes(reason)) {
      return res
        .status(400)
        .json({ error: "Invalid reason. Use REDESIGN or REPRINT" });
    }

    // Check authorization
    if (!["ADMIN", "DESIGNER", "PRINTER"].includes(req.session.role)) {
      return res
        .status(403)
        .json({ error: "Insufficient permissions to replace units" });
    }

    const result = await createReplacementUnit(unitId, reason);

    // Auto-update both batch statuses
    await autoUpdateBatchStatus(result.oldBatch.id);
    await autoUpdateBatchStatus(result.newBatch.id);

    return res.status(200).json({
      message: `Replacement unit created for ${reason}`,
      ...result,
    });
  } catch (err) {
    console.error("Error creating replacement:", err);
    return res.status(500).json({
      message: "Failed to create replacement unit",
      error: err.message,
    });
  }
}

module.exports = {
  listOrders,
  getOrderDetails,
  updateOrderItemStatus,
  replaceUnit,
};
