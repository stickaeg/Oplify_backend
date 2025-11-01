const { decrypt } = require("../lib/crypto");
const prisma = require("../prisma/client");
const { fulfillOrder } = require("../services/shopifyServices");

async function updateOrderStatusFromItems(orderId, tx = prisma) {
  // 🧩 Load order and all related item-unit statuses through BatchItem
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          BatchItem: {
            include: {
              units: {
                select: { status: true },
              },
            },
          },
        },
      },
      store: true, // ✅ Include store to get shopDomain and accessToken
    },
  });

  if (!order || !order.items.length) return;

  // 🧮 Flatten all statuses from all batch item units
  const allStatuses = order.items.flatMap((item) =>
    item.BatchItem.flatMap((bi) => bi.units.map((u) => u.status))
  );

  if (allStatuses.length === 0) return;

  // ✅ All PACKED → COMPLETED
  if (allStatuses.every((s) => s === "PACKED")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "COMPLETED" },
    });

    // ✅ Fulfill the order in Shopify
    console.log(`📦 Order ${orderId} completed, fulfilling in Shopify...`);
    
    const decryptedToken = decrypt(order.store.accessToken);

    try {
      await fulfillOrder(
        order.store.shopDomain,
        decryptedToken, // ← Decrypted
        order.shopifyId
      );
      console.log(`✅ Shopify fulfillment created for order ${orderId}`);
    } catch (err) {
      console.error(
        `❌ Failed to fulfill order in Shopify for order ${orderId}:`,
        err.message
      );
      // Don't throw - we still want the local status updated even if Shopify fails
    }
    return;
  }

  if (allStatuses.every((s) => s === "CUT")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "FULFILLMENT" },
    });
    return;
  }

  // ❌ All CANCELLED → CANCELLED
  if (allStatuses.every((s) => s === "CANCELLED")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });
    return;
  }

  // 🧠 Find earliest active stage based on defined priority
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
        data: { status },
      });
      console.log(`🔄 Order ${orderId} status updated to ${status}`);
      return;
    }
  }
}

module.exports = updateOrderStatusFromItems;
