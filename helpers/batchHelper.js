const { autoUpdateBatchStatus } = require("../controllers/batches.controllers");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");
const prisma = require("../prisma/client");

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

    if (!product || !product.isPod || !product.productType) {
      console.log(`🚫 Skipping item ${item.id}: not POD or missing type`);
      continue;
    }

    // 3️⃣ Get product rule (global)
    const rule = await prisma.productTypeRule.findFirst({
      where: {
        name: { equals: product.productType, mode: "insensitive" },
        isPod: true,
        storeId: product.storeId,
      },
    });

    if (!rule) {
      console.log(
        `⚠️ No global rule found for product type: ${product.productType}`
      );
      continue;
    }

    let remainingQuantity = item.quantity;

    while (remainingQuantity > 0) {
      // 4️⃣ Find existing batches for this rule
      const batches = await prisma.batch.findMany({
        where: {
          rules: { some: { id: rule.id, storeId: product.storeId } }, // 👈 ensure same store
        },
        orderBy: { createdAt: "asc" },
      });
      // Find one with available space
      let availableBatch = batches.find((b) => b.capacity < b.maxCapacity);

      // 5️⃣ If no suitable batch exists, create a new one
      if (!availableBatch) {
        const lastBatch = await prisma.batch.findFirst({
          where: { rules: { some: { id: rule.id } } },
          orderBy: { createdAt: "desc" },
        });

        const baseName = lastBatch
          ? lastBatch.name.split(" - Batch #")[0]
          : rule.name;

        const countForThisName = await prisma.batch.count({
          where: { name: { startsWith: baseName } },
          rules: { some: { storeId: product.storeId } }, 
        });

        const newBatchName =
          countForThisName === 0
            ? baseName
            : `${baseName} - Batch #${countForThisName + 1}`;

        availableBatch = await prisma.batch.create({
          data: {
            name: newBatchName,
            maxCapacity: lastBatch?.maxCapacity || 10, // fallback if null
            capacity: 0,
            status: "PENDING",
            rules: { connect: [{ id: rule.id }] },
          },
        });

        console.log(`🆕 Created new batch: ${availableBatch.name}`);
      }

      // 6️⃣ Determine how many units to add
      const availableSpace =
        availableBatch.maxCapacity - availableBatch.capacity;
      const quantityToAdd = Math.min(remainingQuantity, availableSpace);

      // 7️⃣ Get orderId for later update
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.id },
        select: { orderId: true },
      });

      // 8️⃣ Transaction: create batch item, units, update capacity + statuses
      await prisma.$transaction(async (tx) => {
        // Create BatchItem
        const createdBatchItem = await tx.batchItem.create({
          data: {
            batchId: availableBatch.id,
            orderItemId: item.id,
            quantity: quantityToAdd,
            status: "WAITING_BATCH",
          },
        });

        // Create BatchItemUnits for each unit in this item
        const unitsData = Array.from({ length: quantityToAdd }).map(() => ({
          batchItemId: createdBatchItem.id,
          status: "WAITING_BATCH",
        }));
        await tx.batchItemUnit.createMany({
          data: unitsData,
        });

        // Update batch capacity
        await tx.batch.update({
          where: { id: availableBatch.id },
          data: { capacity: { increment: quantityToAdd } },
        });

        // Update order item status
        await tx.orderItem.update({
          where: { id: item.id },
          data: { status: "WAITING_BATCH" },
        });

        // Update parent order status
        await updateOrderStatusFromItems(orderItem.orderId, tx);
      });

      console.log(
        `✅ Item ${item.id} → ${availableBatch.name} (${quantityToAdd}/${item.quantity})`
      );

      // 9️⃣ Auto-update batch status based on new capacity
      await autoUpdateBatchStatus(availableBatch.id);

      // 🔟 Reduce remaining quantity
      remainingQuantity -= quantityToAdd;
    }
  }
}

module.exports = { assignOrderItemsToBatches };
