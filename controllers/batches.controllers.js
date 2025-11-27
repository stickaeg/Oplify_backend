const prisma = require("../prisma/client");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");
const generateBatchQRCodes = require("../util/generateBatchQRCodes");

async function createBatch(req, res) {
  try {
    const { ruleIds, maxCapacity, batchName, handlesStock } = req.body;

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

    const rules = await prisma.productTypeRule.findMany({
      where: { id: { in: ruleIds } },
    });

    if (rules.length === 0) {
      return res
        .status(404)
        .json({ error: "No ProductTypeRules found for given IDs." });
    }

    const baseName = batchName.trim();

    const countForThisName = await prisma.batch.count({
      where: {
        name: { startsWith: baseName },
      },
    });

    const finalBatchName =
      countForThisName > 0
        ? `${baseName} - Batch #${countForThisName + 1}`
        : `${baseName} - Batch #1`;

    const batch = await prisma.batch.create({
      data: {
        name: finalBatchName,
        maxCapacity: parseInt(maxCapacity),
        capacity: 0,
        status: "PENDING",
        handlesStock: !!handlesStock, // New flag here
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

    const { ruleName } = req.query;

    const where = {};

    if (ruleName) {
      // 🔍 filter by rule name
      where.rules = { some: { name: ruleName } };
    }

    const total = await prisma.batch.count({ where });

    const batches = await prisma.batch.findMany({
      where, // ✅ apply filter
      skip,
      take: limit,
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
            units: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = batches.map((batch) => ({
      id: batch.id,
      name: batch.name,
      capacity: batch.capacity,
      maxCapacity: batch.maxCapacity,
      status: batch.status,
      createdAt: batch.createdAt,
      qrCodeUrl: batch.qrCodeUrl,
      rules: batch.rules.map((r) => ({
        id: r.id,
        name: r.name,
        storeId: r.storeId,
        isPod: r.isPod,
      })),
      items: batch.items.map((bi) => ({
        id: bi.id,
        totalUnits: bi.units.length,
        orderNumber: bi.orderItem.order.orderNumber,
        productTitle: bi.orderItem.product.title,
        storeName: bi.orderItem.order.store.name,
        sku: bi.orderItem.variant?.sku || null,
        status: bi.status,
        units: bi.units.map((u) => ({
          id: u.id,
          qrCodeUrl: u.qrCodeUrl,
          status: u.status,
        })),
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
    if (!batchId)
      return res.status(400).json({ error: "Batch ID is required" });

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
            units: true,
          },
        },
        File: true,
      },
    });

    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const formatted = {
      id: batch.id,
      name: batch.name,
      capacity: batch.capacity,
      maxCapacity: batch.maxCapacity,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      rules: batch.rules.map((r) => ({
        id: r.id,
        name: r.name,
        storeId: r.storeId,
        isPod: r.isPod,
      })),
      items: batch.items.map((bi) => ({
        id: bi.id,
        totalUnits: bi.units.length,
        productTitle: bi.orderItem?.product?.title ?? null,
        productImgUrl: bi.orderItem?.product?.imgUrl ?? null, // 👈 add this line

        sku: bi.orderItem?.variant?.sku ?? null,
        orderNumber: bi.orderItem?.order?.orderNumber ?? null,
        storeName: bi.orderItem?.order?.store?.name ?? null,
        units: bi.units.map((u) => ({
          id: u.id,
          status: u.status,
        })),
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
      "PRINTED",
      "CUTTING",
      "REPRINT",
      "REDESIGN",
      "CUT",
      "FULFILLMENT",
      "PACKED",
      "COMPLETED",
      "CANCELLED",
      "RETURNED",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid batch status" });
    }

    const batch = await prisma.$transaction(async (tx) => {
      // ✅ Update batch status
      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: { status },
        include: {
          items: {
            include: {
              units: true,
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
      });

      // ✅ Update all batch items
      await tx.batchItem.updateMany({
        where: { batchId },
        data: { status },
      });

      // ✅ Fix: get all BatchItem IDs and update their units
      const itemIds = updatedBatch.items.map((i) => i.id);

      if (itemIds.length > 0) {
        await tx.batchItemUnit.updateMany({
          where: { batchItemId: { in: itemIds } },
          data: { status },
        });
      }

      // ✅ Update all linked order items
      const orderItemIds = updatedBatch.items
        .map((item) => item.orderItemId)
        .filter(Boolean);

      if (orderItemIds.length > 0) {
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status },
        });

        // ✅ Update parent orders
        const uniqueOrderIds = [
          ...new Set(
            updatedBatch.items
              .map((item) => item.orderItem?.orderId)
              .filter(Boolean)
          ),
        ];

        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }
      }

      return updatedBatch;
    });

    console.log(
      `✅ Batch ${batchId} and all related records updated to ${status}`
    );
    res.json(batch);
  } catch (err) {
    console.error("❌ Error updating batch status:", err);
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
            units: true,
          },
        },
        File: { select: { id: true } },
      },
    });

    if (!batch) return null;

    const autoStatuses = ["PENDING", "WAITING_BATCH", "BATCHED", "DESIGNING"];
    if (!autoStatuses.includes(batch.status)) return batch;

    let newStatus = batch.status;

    // ✅ Determine new status
    if (batch.File.length > 0) newStatus = "DESIGNED";
    else if (batch.capacity === 0) newStatus = "PENDING";
    else if (batch.capacity < batch.maxCapacity) newStatus = "WAITING_BATCH";
    else if (batch.capacity >= batch.maxCapacity) newStatus = "BATCHED";

    if (newStatus !== batch.status) {
      const updatedBatch = await prisma.$transaction(async (tx) => {
        const updated = await tx.batch.update({
          where: { id: batchId },
          data: { status: newStatus },
        });

        await tx.batchItem.updateMany({
          where: { batchId },
          data: { status: newStatus },
        });

        await tx.batchItemUnit.updateMany({
          where: { batchItem: { batchId } },
          data: { status: newStatus },
        });

        const orderItemIds = batch.items.map((i) => i.orderItem.id);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: newStatus },
        });

        const uniqueOrderIds = [
          ...new Set(batch.items.map((i) => i.orderItem.orderId)),
        ];

        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }

        return updated;
      });

      console.log(
        `🔄 Batch ${batchId} auto-updated: ${batch.status} → ${newStatus}`
      );

      if (newStatus === "BATCHED" && !batch.qrCodeUrl) {
        const qrUrl = await generateBatchQRCodes(batchId);
        await prisma.batch.update({
          where: { id: batchId },
          data: { qrCodeUrl: qrUrl },
        });
        console.log(`✅ QR code generated for batch ${batchId}`);
      }

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
