const prisma = require("../prisma/client");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");

async function createBatch(req, res) {
  try {
    const { ruleIds, maxCapacity, batchName } = req.body;

    // 🧩 Validate input
    if (
      !ruleIds ||
      !Array.isArray(ruleIds) ||
      ruleIds.length === 0 ||
      !maxCapacity ||
      !batchName?.trim()
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: ruleIds (array), maxCapacity, and batchName",
      });
    }

    // 🕵️ Fetch all matching rules
    const rules = await prisma.productTypeRule.findMany({
      where: { id: { in: ruleIds } },
    });

    if (rules.length === 0) {
      return res
        .status(404)
        .json({ error: "No ProductTypeRules found for given IDs." });
    }

    const baseName = batchName.trim();

    // Count how many existing batches already share this name pattern
    const countForThisName = await prisma.batch.count({
      where: { name: { startsWith: baseName } },
    });

    // Add suffix if duplicates exist
    const finalBatchName =
      countForThisName > 0
        ? `${baseName} - Batch #${countForThisName + 1}`
        : `${baseName} - Batch #1`;git rm --cached services/crm_account_services.json
echo "services/crm_account_services.json" >> .gitignore
git add .gitignore
git commit -m "Remove secret file and ignore it"

    // 🚀 Create batch
    const batch = await prisma.batch.create({
      data: {
        name: finalBatchName,
        maxCapacity: parseInt(maxCapacity),
        capacity: 0,
        status: "PENDING",
        rules: { connect: rules.map((r) => ({ id: r.id })) },
      },
      include: { rules: true },
    });

    return res.status(201).json({
      message: "Batch created successfully",
      batch,
    });
  } catch (err) {
    console.error("Error creating batch:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function listBatches(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // total count
    const total = await prisma.batch.count();

    // fetch paginated batches with their related data
    const batches = await prisma.batch.findMany({
      skip,
      take: limit,
      include: {
        rules: true, // ✅ include all linked rules
        items: {
          include: {
            orderItem: {
              include: {
                order: { include: { store: true } },
                product: true,
                variant: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // format response
    const formatted = batches.map((batch) => ({
      id: batch.id,
      name: batch.name,
      capacity: batch.capacity,
      maxCapacity: batch.maxCapacity,
      status: batch.status,
      createdAt: batch.createdAt,

      // ✅ multiple rules now
      rules: batch.rules.map((r) => ({
        id: r.id,
        name: r.name,
        storeName: r.storeId, // you can also join Store if you want store name
        isPod: r.isPod,
      })),

      items: batch.items.map((bi) => ({
        sku: bi.orderItem.variant?.sku || null,
        orderNumber: bi.orderItem.order.orderNumber,
        title: bi.orderItem.product.title,
        storeName: bi.orderItem.order.store.name,
        quantityInBatch: bi.quantity,
      })),
    }));

    return res.status(200).json({
      data: formatted,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Error listing batches:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function getBatchById(req, res) {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({ error: "Batch ID is required" });
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        rules: true,
        items: {
          include: {
            orderItem: {
              include: {
                order: { include: { store: true } },
                product: true,
                variant: true,
              },
            },
          },
        },
        File: true,
      },
    });

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // ✅ Include QR code URLs
    const formatted = {
      id: batch.id,
      name: batch.name,
      capacity: batch.capacity,
      maxCapacity: batch.maxCapacity,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      qrCodeUrl: batch.qrCodeUrl, // ✅ batch QR

      rules: batch.rules.map((r) => ({
        id: r.id,
        name: r.name,
        storeId: r.storeId,
        isPod: r.isPod,
      })),

      items: batch.items.map((bi) => ({
        id: bi.id,
        quantityInBatch: bi.quantity,
        orderNumber: bi.orderItem.order.orderNumber,
        qrCodeUrl: bi.qrCodeUrl, // ✅ item QR
        productTitle: bi.orderItem.product.title,
        storeName: bi.orderItem.order.store.name,
        sku: bi.orderItem.variant?.sku || null,
      })),

      files: batch.File.map((f) => ({
        id: f.id,
        name: f.name,
        status: f.status,
        mimeType: f.mimeType,
        size: f.size,
        uploadedAt: f.createdAt,
      })),
    };

    return res.status(200).json(formatted);
  } catch (err) {
    console.error("Error fetching batch details:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function updateBatchStatus(req, res) {
  try {
    const { batchId } = req.params;
    const { status } = req.body;

    const validStatuses = [
      "PENDING",
      "WAITING_BATCH",
      "BATCHED",
      "DESIGNING",
      "DESIGNED",
      "PRINTING",
      "PRINTED", // ✅ ADD THIS
      "CUTTING",
      "CUT", // ✅ ADD THIS
      "FULFILLMENT",
      "PACKED", // ✅ ADD THIS
      "COMPLETED",
      "CANCELLED",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid batch status" });
    }

    // ✅ Use transaction to update batch and all related items atomically
    const batch = await prisma.$transaction(async (tx) => {
      // Update the batch
      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: { status: status },
        include: {
          items: {
            include: {
              orderItem: {
                select: { id: true, orderId: true },
              },
            },
          },
        },
      });

      // ✅ Update all batch items
      if (updatedBatch.items.length > 0) {
        await tx.batchItem.updateMany({
          where: { batchId: batchId },
          data: { status: status },
        });

        // ✅ Update all related order items
        const orderItemIds = updatedBatch.items.map((item) => item.orderItemId);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: status },
        });

        // ✅ Update parent orders if necessary
        const uniqueOrderIds = [
          ...new Set(updatedBatch.items.map((item) => item.orderItem.orderId)),
        ];

        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }
      }

      return updatedBatch;
    });

    console.log(
      `✅ Batch ${batchId} and all related items updated to status: ${status}`
    );

    res.json(batch);
  } catch (err) {
    console.error("Error updating batch status:", err);
    res.status(500).json({
      message: "Failed to update batch status",
      error: err.message,
    });
  }
}

async function autoUpdateBatchStatus(batchId) {
  try {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          include: {
            orderItem: {
              select: { id: true, orderId: true },
            },
          },
        },
        File: { select: { id: true } },
      },
    });

    if (!batch) return null;

    const autoUpdateableStatuses = [
      "PENDING",
      "WAITING_BATCH",
      "BATCHED",
      "DESIGNING",
    ];

    if (!autoUpdateableStatuses.includes(batch.status)) return batch;

    let newStatus = batch.status;

    // ✅ Priority 1: If files exist, status should be DESIGNED
    if (batch.File && batch.File.length > 0) {
      newStatus = "DESIGNED";
    }
    // ✅ Priority 2: Check capacity-based statuses only if no files
    else if (batch.capacity === 0) {
      newStatus = "PENDING";
    } else if (batch.capacity < batch.maxCapacity) {
      newStatus = "WAITING_BATCH";
    } else if (batch.capacity >= batch.maxCapacity) {
      newStatus = "BATCHED";
    }

    // Only update if status changed
    if (newStatus !== batch.status) {
      // ✅ Use transaction to cascade status updates
      const updatedBatch = await prisma.$transaction(async (tx) => {
        // Update batch
        const updated = await tx.batch.update({
          where: { id: batchId },
          data: { status: newStatus },
        });

        // ✅ Update all batch items
        if (batch.items.length > 0) {
          await tx.batchItem.updateMany({
            where: { batchId: batchId },
            data: { status: newStatus },
          });

          // ✅ Update all related order items
          const orderItemIds = batch.items.map((item) => item.orderItemId);
          await tx.orderItem.updateMany({
            where: { id: { in: orderItemIds } },
            data: { status: newStatus },
          });

          // ✅ Update parent orders
          const uniqueOrderIds = [
            ...new Set(batch.items.map((item) => item.orderItem.orderId)),
          ];

          for (const orderId of uniqueOrderIds) {
            await updateOrderStatusFromItems(orderId, tx);
          }
        }

        return updated;
      });

      console.log(
        `🔄 Batch ${batchId} and all items auto-updated: ${batch.status} → ${newStatus}`
      );

      return updatedBatch;
    }

    return batch;
  } catch (err) {
    console.error("Error auto-updating batch status:", err);
    return null;
  }
}

module.exports = {
  createBatch,
  listBatches,
  updateBatchStatus,
  autoUpdateBatchStatus,
  getBatchById,
};
