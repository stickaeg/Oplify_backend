const { autoUpdateBatchStatus } = require("../controllers/batches.controllers");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems"); // ✅ Add this import
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

    // 3️⃣ Get the product rule (global)
    const rule = await prisma.productTypeRule.findFirst({
      where: {
        name: { equals: product.productType, mode: "insensitive" },
        isPod: true,
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
      // 4️⃣ Find existing batches that include this rule (global)
      const batches = await prisma.batch.findMany({
        where: {
          rules: { some: { id: rule.id } },
        },
        orderBy: { createdAt: "asc" },
      });

      // Find one with available space
      let availableBatch = batches.find((b) => b.capacity < b.maxCapacity);

      // 5️⃣ If no suitable batch exists, create a new one
      if (!availableBatch) {
        // Get the most recent batch for this rule
        const lastBatch = await prisma.batch.findFirst({
          where: {
            rules: { some: { id: rule.id } },
          },
          orderBy: { createdAt: "desc" },
        });

        // Determine base name (strip suffix if any)
        let baseName = lastBatch
          ? lastBatch.name.split(" - Batch #")[0]
          : rule.name;

        // Count existing batches for that base name
        const countForThisName = await prisma.batch.count({
          where: { name: { startsWith: baseName } },
        });

        const newBatchName =
          countForThisName === 0
            ? baseName
            : `${baseName} - Batch #${countForThisName + 1}`;

        availableBatch = await prisma.batch.create({
          data: {
            name: newBatchName,
            maxCapacity: lastBatch?.maxCapacity || 10, // ✅ Add default if lastBatch is null
            capacity: 0,
            status: "PENDING",
            rules: { connect: [{ id: rule.id }] },
          },
        });
      }

      // 6️⃣ Add item to batch
      const availableSpace =
        availableBatch.maxCapacity - availableBatch.capacity;
      const quantityToAdd = Math.min(remainingQuantity, availableSpace);

      // ✅ Get orderId before transaction
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.id },
        select: { orderId: true },
      });

      // ✅ Use single transaction with proper status updates
      await prisma.$transaction(async (tx) => {
        // Create batch item with status
        await tx.batchItem.create({
          data: {
            batchId: availableBatch.id,
            orderItemId: item.id,
            quantity: quantityToAdd,
            status: "WAITING_BATCH", // ✅ Set initial status
          },
        });

        // Update batch capacity
        await tx.batch.update({
          where: { id: availableBatch.id },
          data: { capacity: { increment: quantityToAdd } },
        });

        // Update order item status
        await tx.orderItem.update({
          where: { id: item.id },
          data: { status: "WAITING_BATCH" }, // ✅ Changed from BATCHED to WAITING_BATCH
        });

        // ✅ Update parent order status
        await updateOrderStatusFromItems(orderItem.orderId, tx);
      });

      console.log(
        `✅ Item ${item.id} assigned to ${availableBatch.name} (${quantityToAdd}/${item.quantity})`
      );

      // 7️⃣ Auto-update batch status based on new capacity
      // This will also cascade to items if batch becomes BATCHED
      await autoUpdateBatchStatus(availableBatch.id);

      remainingQuantity -= quantityToAdd;
    }
  }
}

module.exports = { assignOrderItemsToBatches };
