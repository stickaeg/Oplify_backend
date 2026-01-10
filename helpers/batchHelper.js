const prisma = require("../prisma/client");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { autoUpdateBatchStatus } = require("../controllers/batches.controllers");
const updateOrderStatusFromItems = require("./updateOrderStatusFromItems");

async function assignOrderItemsToBatches(orderItems) {
  for (const item of orderItems) {
    // 1️⃣ Skip if already batched
    const existingBatchItem = await prisma.batchItem.findFirst({
      where: { orderItemId: item.id },
    });
    if (existingBatchItem) {
      console.log(`⚠️ Item ${item.id} is already batched, skipping`);
      continue;
    }

    // 2️⃣ Get product info
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
    });

    if (!product || !product.productType) {
      continue;
    }

    // 3️⃣ Get variant info to obtain the title
    const variant = item.variantId
      ? await prisma.productVariant.findUnique({
          where: { id: item.variantId },
        })
      : null;

    const variantTitle = variant?.title || null;

    // 4️⃣ Get product rule matching productType and variantTitle
    const rule = await prisma.productTypeRule.findFirst({
      where: {
        storeId: product.storeId,
        name: { equals: product.productType, mode: "insensitive" },
        OR: [
          { variantTitle: variantTitle || undefined }, // exact variant
          { variantTitle: null }, // generic rule
        ],
      },
    });

    console.log("Batch rule lookup", {
      productType: product.productType,
      variantTitle,
      rule,
    });

    if (!rule) {
      console.log(
        `⚠️ No rule found for product type '${product.productType}' with variant '${variantTitle}'`
      );
      continue;
    }

    // 5️⃣ Determine if batch should handle stock based on product rule
    const needsStockHandling = rule.requiresStock === true;
    const isPod = rule.isPod === true;

    if (!isPod && !needsStockHandling) {
      console.log(
        `🚫 Skipping item ${item.id}: neither POD nor stock required`
      );
      continue;
    }

    let remainingQuantity = item.quantity;

    while (remainingQuantity > 0) {
      // 6️⃣ Find existing batches for this rule matching stock handling flag
      const batches = await prisma.batch.findMany({
        where: {
          rules: { some: { id: rule.id, storeId: product.storeId } },
          handlesStock: needsStockHandling,
        },
        orderBy: { createdAt: "asc" },
      });

      // Find batch with available space
      let availableBatch = batches.find((b) => b.capacity < b.maxCapacity);

      // 7️⃣ If no suitable batch exists, create a new one
      if (!availableBatch) {
        // find the last batch for this rule, including its rules
        const lastBatch = await prisma.batch.findFirst({
          where: { rules: { some: { id: rule.id } } },
          orderBy: { createdAt: "desc" },
          include: { rules: true },
        });

        const baseName = lastBatch
          ? lastBatch.name.split(" - Batch #")[0]
          : variantTitle
          ? `${rule.name} - ${variantTitle}`
          : rule.name;

        const countForThisName = await prisma.batch.count({
          where: {
            name: { startsWith: baseName },
            rules: { some: { storeId: product.storeId } },
          },
        });

        const newBatchName =
          countForThisName === 0
            ? baseName
            : `${baseName} - Batch #${countForThisName + 1}`;

        // if lastBatch exists, copy all its rules; otherwise fall back to the single rule
        const rulesToConnect = lastBatch?.rules?.length
          ? lastBatch.rules.map((r) => ({ id: r.id }))
          : [{ id: rule.id }];

        availableBatch = await prisma.batch.create({
          data: {
            name: newBatchName,
            maxCapacity: lastBatch?.maxCapacity || 10,
            capacity: 0,
            status: "PENDING",
            handlesStock: needsStockHandling,
            rules: {
              connect: rulesToConnect,
            },
          },
        });

        console.log(
          `🆕 Created new batch: ${availableBatch.name} with rules:`,
          rulesToConnect.map((r) => r.id)
        );
      }

      // 8️⃣ Determine how many units to add
      const availableSpace =
        availableBatch.maxCapacity - availableBatch.capacity;
      const quantityToAdd = Math.min(remainingQuantity, availableSpace);

      // 9️⃣ Get orderId for updating order status later
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.id },
        select: { orderId: true },
      });

      // 1️⃣0️⃣ Transaction: create batch item, units, update capacity and statuses
      await prisma.$transaction(async (tx) => {
        const createdBatchItem = await tx.batchItem.create({
          data: {
            batchId: availableBatch.id,
            orderItemId: item.id,
            quantity: quantityToAdd,
            status: "WAITING_BATCH",
          },
        });

        const unitsData = Array.from({ length: quantityToAdd }).map(() => ({
          batchItemId: createdBatchItem.id,
          status: "WAITING_BATCH",
        }));

        await tx.batchItemUnit.createMany({ data: unitsData });

        await tx.batch.update({
          where: { id: availableBatch.id },
          data: { capacity: { increment: quantityToAdd } },
        });

        await tx.orderItem.update({
          where: { id: item.id },
          data: { status: "WAITING_BATCH" },
        });

        // 🔁 UPDATED: stock lookup now uses array fields
        if (needsStockHandling) {
          const variantForStock = item.variantId
            ? await tx.productVariant.findUnique({
                where: { id: item.variantId },
                include: {
                  product: {
                    include: {
                      store: true,
                    },
                  },
                },
              })
            : null;

          const variantTitleForStock = variantForStock?.title || null;
          const storeNameForStock = variantForStock?.product.store.name || null;
          const productTypeForStock =
            variantForStock?.product.productType || null;

          if (
            variantTitleForStock &&
            storeNameForStock &&
            productTypeForStock
          ) {
            const stockVariant = await tx.stockVariant.findFirst({
              where: {
                variantTitles: { has: variantTitleForStock },
                storeIds: { has: storeNameForStock },
                productTypes: { has: productTypeForStock },
              },
            });

            if (!stockVariant) {
              console.warn(
                `⚠️ No StockVariant found for store "${storeNameForStock}", productType "${productTypeForStock}", variantTitle "${variantTitleForStock}"`
              );
            } else {
              if (stockVariant.currentStock < quantityToAdd) {
                throw new Error(
                  `Insufficient stock for ${stockVariant.name} (have ${stockVariant.currentStock}, need ${quantityToAdd})`
                );
              }

              await tx.stockVariant.update({
                where: { id: stockVariant.id },
                data: {
                  currentStock: { decrement: quantityToAdd },
                },
              });
            }
          }
        }

        await updateOrderStatusFromItems(orderItem.orderId, tx);
      });

      console.log(
        `✅ Item ${item.id} → ${availableBatch.name} (${quantityToAdd}/${remainingQuantity})`
      );

      // 1️⃣1️⃣ Auto-update batch status
      await autoUpdateBatchStatus(availableBatch.id);

      // 1️⃣2️⃣ Reduce remaining quantity
      remainingQuantity -= quantityToAdd;
    }
  }
}

async function createReplacementUnit(unitId, reason = "REDESIGN") {
  return await prisma.$transaction(async (tx) => {
    // 1️⃣ Get the corrupted unit
    const corruptedUnit = await tx.batchItemUnit.findUnique({
      where: { id: unitId },
      include: {
        batchItem: {
          include: {
            batch: true,
            orderItem: {
              include: {
                product: { include: { store: true } },
              },
            },
          },
        },
      },
    });

    if (!corruptedUnit) {
      throw new Error(`Unit ${unitId} not found`);
    }

    const oldBatch = corruptedUnit.batchItem.batch;
    const orderItem = corruptedUnit.batchItem.orderItem;
    const product = orderItem.product;

    console.log(
      `🔄 Creating replacement for unit ${unitId} (Reason: ${reason})`
    );

    // 2️⃣ Mark the corrupted unit as CANCELLED
    await tx.batchItemUnit.update({
      where: { id: unitId },
      data: { status: "CANCELLED" },
    });

    // 3️⃣ Get product rule
    const rule = await tx.productTypeRule.findFirst({
      where: {
        name: { equals: product.productType, mode: "insensitive" },
        isPod: true,
        storeId: product.storeId,
      },
    });

    if (!rule) {
      throw new Error(`No rule found for product type: ${product.productType}`);
    }

    // 4️⃣ Find or create target batch
    let targetBatch = await tx.batch.findFirst({
      where: {
        rules: { some: { id: rule.id } },
        capacity: { lt: tx.batch.fields.maxCapacity },
        status: { in: ["PENDING", "WAITING_BATCH"] },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!targetBatch) {
      const lastBatch = await tx.batch.findFirst({
        where: { rules: { some: { id: rule.id } } },
        orderBy: { createdAt: "desc" },
      });

      const baseName = lastBatch
        ? lastBatch.name.split(" - Batch #")[0]
        : rule.name;

      const countForThisName = await tx.batch.count({
        where: {
          name: { startsWith: baseName },
          rules: { some: { storeId: product.storeId } },
        },
      });

      const newBatchName =
        countForThisName === 0
          ? baseName
          : `${baseName} - Batch #${countForThisName + 1}`;

      targetBatch = await tx.batch.create({
        data: {
          name: newBatchName,
          maxCapacity: lastBatch?.maxCapacity || 10,
          capacity: 0,
          status: "PENDING",
          rules: { connect: [{ id: rule.id }] },
        },
      });

      console.log(`🆕 Created new batch: ${targetBatch.name}`);
    }

    // 5️⃣ Find or create BatchItem in target batch
    let targetBatchItem = await tx.batchItem.findFirst({
      where: {
        batchId: targetBatch.id,
        orderItemId: orderItem.id,
      },
    });

    if (!targetBatchItem) {
      targetBatchItem = await tx.batchItem.create({
        data: {
          batchId: targetBatch.id,
          orderItemId: orderItem.id,
          quantity: 0,
          status: "WAITING_BATCH",
        },
      });
    }

    // 6️⃣ Generate new QR token (simple version)
    const newToken = crypto.randomBytes(8).toString("hex");

    // 7️⃣ Create NEW replacement unit
    const newUnit = await tx.batchItemUnit.create({
      data: {
        batchItemId: targetBatchItem.id,
        status: "WAITING_BATCH",
        qrCodeToken: newToken,
        // qrCodeUrl will be generated separately if needed
      },
    });

    // 8️⃣ Update quantities
    await tx.batchItem.update({
      where: { id: targetBatchItem.id },
      data: { quantity: { increment: 1 } },
    });

    await tx.batch.update({
      where: { id: targetBatch.id },
      data: { capacity: { increment: 1 } },
    });

    // 9️⃣ Recalculate old BatchItem status
    const oldBatchItemUnits = await tx.batchItemUnit.findMany({
      where: { batchItemId: corruptedUnit.batchItemId },
      select: { status: true },
    });

    const oldBatchItemStatus = deriveStatusFromUnits(
      oldBatchItemUnits.map((u) => u.status)
    );

    await tx.batchItem.update({
      where: { id: corruptedUnit.batchItemId },
      data: { status: oldBatchItemStatus },
    });

    // 🔟 Recalculate OrderItem status (exclude cancelled)
    const allOrderItemUnits = await tx.batchItemUnit.findMany({
      where: {
        batchItem: { orderItemId: orderItem.id },
        status: { not: "CANCELLED" },
      },
      select: { status: true },
    });

    const orderItemStatus = deriveStatusFromUnits(
      allOrderItemUnits.map((u) => u.status)
    );

    await tx.orderItem.update({
      where: { id: orderItem.id },
      data: { status: orderItemStatus },
    });

    // 1️⃣1️⃣ Update Order status
    await updateOrderStatusFromItems(orderItem.orderId, tx);

    console.log(
      `✅ Replacement unit ${newUnit.id} created in ${targetBatch.name}`
    );

    return {
      corruptedUnitId: unitId,
      newUnitId: newUnit.id,
      newUnitQRToken: newToken,
      oldBatch: { id: oldBatch.id, name: oldBatch.name },
      newBatch: { id: targetBatch.id, name: targetBatch.name },
      reason,
    };
  });
}

function deriveStatusFromUnits(statuses) {
  if (!statuses.length) return "WAITING_BATCH";

  const uniqueStatuses = [...new Set(statuses)];
  if (uniqueStatuses.length === 1) return uniqueStatuses[0];

  const statusPriority = [
    "COMPLETED",
    "PACKED",
    "FULFILLMENT",
    "CUT",
    "CUTTING",
    "PRINTED",
    "PRINTING",
    "DESIGNED",
    "DESIGNING",
    "BATCHED",
    "WAITING_BATCH",
    "REDESIGN",
    "REPRINT",
    "PENDING",
    "CANCELLED",
    "RETURNED",
  ];

  for (const status of statusPriority) {
    if (statuses.includes(status)) return status;
  }

  return "WAITING_BATCH";
}

module.exports = { assignOrderItemsToBatches, createReplacementUnit };
