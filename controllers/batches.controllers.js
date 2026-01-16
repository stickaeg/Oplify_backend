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

    // 🔍 1️⃣ Fetch rules WITH variantTitle
    const rules = await prisma.productTypeRule.findMany({
      where: { id: { in: ruleIds } },
      include: { store: true }, // Need store for validation
    });

    if (rules.length === 0) {
      return res
        .status(404)
        .json({ error: "No ProductTypeRules found for given IDs." });
    }

    const hasSpecificVariants = rules.some((r) => r.variantTitle);

    // If any rule has variantTitle, ALL must match or be null
    if (hasSpecificVariants) {
      const variantTitles = rules.map((r) => r.variantTitle).filter(Boolean);
      if (new Set(variantTitles).size > 1) {
        return res.status(400).json({
          error: "Cannot mix different variant titles in one batch",
        });
      }
    }

    // 🏷️ 3️⃣ SMART BATCH NAME with variant awareness
    const baseName = batchName.trim(); // <-- from req.body, not from rules

    const countForThisName = await prisma.batch.count({
      where: {
        name: { startsWith: baseName },
        // if you really don't want name to depend on rules, you can drop this filter:
        // rules: { some: { id: { in: ruleIds } } },
      },
    });

    const finalBatchName =
      countForThisName > 0
        ? `${baseName} - Batch #${countForThisName + 1}`
        : `${baseName} - Batch #1`;

    // 🚀 4️⃣ Create batch with proper settings
    const batch = await prisma.batch.create({
      data: {
        name: finalBatchName,
        maxCapacity: parseInt(maxCapacity),
        capacity: 0,
        status: "WAITING_BATCH", // Match your enum
        handlesStock: !!handlesStock,
        rules: { connect: rules.map((r) => ({ id: r.id })) },
      },
      include: {
        rules: {
          select: {
            name: true,
            variantTitle: true,
            isPod: true,
            requiresStock: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: "Batch created successfully",
      batch,
      rules: rules.map((r) => ({
        name: r.name,
        variantTitle: r.variantTitle,
        smartBatchName: finalBatchName,
      })),
    });
  } catch (err) {
    console.error("Error creating batch:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

async function listBatches(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { ruleName, startDate, endDate, search } = req.query;

    const where = {};

    if (ruleName) {
      // 🔍 filter by rule name
      where.rules = { some: { name: ruleName } };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { rules: { some: { name: { contains: search, mode: "insensitive" } } } },
      ];
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

async function updateBatchRules(req, res) {
  try {
    const { batchId } = req.params;
    const {
      ruleIdsToAdd = [],
      ruleIdsToRemove = [],
      maxCapacity, // optional
    } = req.body;

    console.log("updateBatchRules input:", {
      batchId,
      ruleIdsToAdd,
      ruleIdsToRemove,
      maxCapacity,
    });

    if (!batchId) {
      return res.status(400).json({ error: "Batch ID is required" });
    }

    if (
      (!Array.isArray(ruleIdsToAdd) || ruleIdsToAdd.length === 0) &&
      (!Array.isArray(ruleIdsToRemove) || ruleIdsToRemove.length === 0) &&
      typeof maxCapacity === "undefined"
    ) {
      return res.status(400).json({
        error:
          "Provide at least one of ruleIdsToAdd[], ruleIdsToRemove[] or maxCapacity",
      });
    }

    // 1) Load batch with current rules
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { rules: true },
    });

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // 2) Load rules to add for validation
    const rulesToAdd = ruleIdsToAdd.length
      ? await prisma.productTypeRule.findMany({
        where: { id: { in: ruleIdsToAdd } },
      })
      : [];

    if (rulesToAdd.length !== ruleIdsToAdd.length) {
      return res.status(400).json({
        error: "Some ruleIdsToAdd do not exist",
      });
    }

    // 3) VariantTitle compatibility (same logic as createBatch)
    const allRulesAfterAdd = [...batch.rules, ...rulesToAdd];
    const hasSpecificVariants = allRulesAfterAdd.some((r) => r.variantTitle);

    if (hasSpecificVariants) {
      const variantTitles = allRulesAfterAdd
        .map((r) => r.variantTitle)
        .filter(Boolean);
      if (new Set(variantTitles).size > 1) {
        return res.status(400).json({
          error: "Cannot mix different variant titles in one batch",
        });
      }
    }

    // 4) Build connect / disconnect arrays
    const existingIds = new Set(batch.rules.map((r) => r.id));

    const connect = rulesToAdd
      .filter((r) => !existingIds.has(r.id))
      .map((r) => ({ id: r.id }));

    const disconnect =
      Array.isArray(ruleIdsToRemove) && ruleIdsToRemove.length > 0
        ? ruleIdsToRemove.map((id) => ({ id }))
        : [];

    // 5) Build data object for Prisma update
    const data = {
      rules: {
        ...(connect.length ? { connect } : {}),
        ...(disconnect.length ? { disconnect } : {}),
      },
    };

    if (typeof maxCapacity !== "undefined") {
      // basic guard, adjust as you like
      if (!Number.isInteger(maxCapacity) || maxCapacity <= 0) {
        return res
          .status(400)
          .json({ error: "maxCapacity must be a positive integer" });
      }
      data.maxCapacity = maxCapacity;
    }

    const updatedBatch = await prisma.batch.update({
      where: { id: batchId },
      data,
      include: { rules: true },
    });

    return res.status(200).json({
      message: "Batch rules updated successfully",
      batch: updatedBatch,
    });
  } catch (err) {
    console.error("Error updating batch rules:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

async function getBatchRules(req, res) {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({ error: "Batch ID is required" });
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { rules: true },
    });

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    const currentRules = batch.rules;

    return res.status(200).json({
      batch: {
        id: batch.id,
        name: batch.name,
        capacity: batch.capacity, // optional
        maxCapacity: batch.maxCapacity, // so UI can edit
      },
      rules: currentRules.map((r) => ({
        id: r.id,
        name: r.name,
        storeId: r.storeId,
        variantTitle: r.variantTitle,
        isPod: r.isPod,
        requiresStock: r.requiresStock,
        selected: true,
      })),
    });
  } catch (err) {
    console.error("Error fetching batch rules:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
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
      "FULFILLED",
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
  updateBatchRules,
  getBatchRules,
};
