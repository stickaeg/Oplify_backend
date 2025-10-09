const prisma = require("../prisma/client");

async function updateOrderStatusFromItems(orderId, tx = prisma) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: { status: true },
      },
    },
  });

  if (!order || !order.items.length) return;

  const allStatuses = order.items.map((item) => item.status);

  // If all items are PACKED, order is COMPLETED
  if (allStatuses.every((s) => s === "PACKED")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "COMPLETED" },
    });
    console.log(`✅ Order ${orderId} marked as COMPLETED`);
    return;
  }

  // If any item is CANCELLED, but not all, keep order active
  if (allStatuses.some((s) => s === "CANCELLED")) {
    const nonCancelledStatuses = allStatuses.filter((s) => s !== "CANCELLED");
    if (nonCancelledStatuses.length === 0) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED" },
      });
      console.log(`❌ Order ${orderId} marked as CANCELLED`);
      return;
    }
  }

  // Otherwise, use the "earliest" status in the workflow
  const statusPriority = [
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
  ];

  for (const status of statusPriority) {
    if (allStatuses.includes(status)) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: status },
      });
      console.log(`🔄 Order ${orderId} status updated to ${status}`);
      return;
    }
  }
}

module.exports = updateOrderStatusFromItems;
