const { decrypt } = require("../lib/crypto");
const prisma = require("../prisma/client");
const {
  fulfillOrder,
  cancelOrder,
  createRefund,
} = require("../services/shopifyServices");

async function updateOrderStatusFromItems(orderId, tx = prisma) {
  // 🧩 Load order and all related item-unit statuses through BatchItem
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: true,
          BatchItem: {
            include: {
              units: {
                select: { status: true },
              },
            },
          },
        },
      },
      store: true,
    },
  });

  if (!order || !order.items.length) return;

  // 🧮 Collect all relevant statuses + track RETURNED items
  const allStatuses = [];
  const returnedItems = []; // ✅ NEW: Track items for refund

  for (const item of order.items) {
    if (item.BatchItem && item.BatchItem.length > 0) {
      // ✅ If item has batches, check unit statuses
      const unitStatuses = item.BatchItem.flatMap((bi) =>
        bi.units.map((u) => {
          if (u.status === "RETURNED") {
            returnedItems.push(item); // Track the OrderItem for refund
          }
          return u.status;
        })
      );
      allStatuses.push(...unitStatuses);
    } else {
      // ✅ If no batches, use OrderItem status
      if (item.status === "RETURNED") {
        returnedItems.push(item); // Track for refund
      }
      allStatuses.push(item.status);
    }
  }

  if (allStatuses.length === 0) return;

  // ❌ All CANCELLED → CANCELLED + Cancel in Shopify
  if (allStatuses.every((s) => s === "CANCELLED")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });

    console.log(`🛑 Order ${orderId} cancelled, cancelling in Shopify...`);
    const decryptedToken = decrypt(order.store.accessToken);

    try {
      await cancelOrder(
        order.store.shopDomain,
        decryptedToken,
        order.shopifyId,
        {
          refund: true,
          restock: true,
          reason: "CUSTOMER",
        }
      );
      console.log(`✅ Shopify order ${orderId} cancelled`);
    } catch (err) {
      console.error(
        `❌ Failed to cancel order in Shopify for order ${orderId}:`,
        err.message
      );
    }
    return;
  }

  // ✅ NEW: Handle RETURNED items → Create Shopify refunds
  if (returnedItems.length > 0) {
    console.log(
      `↩️ Processing ${returnedItems.length} returned item(s) for order ${orderId}`
    );
    const decryptedToken = decrypt(order.store.accessToken);

    for (const item of returnedItems) {
      try {
        const transactions = JSON.parse(order.shopifyTransactions || "[]");
        const firstTransaction = transactions[0];

        await createRefund(order.store.shopDomain, decryptedToken, {
          orderId: order.shopifyId,
          lineItemId: item.shopifyLineItemId,
          quantity: 1,
          amount: item.price?.toString() || "0.00",
          currencyCode: order.shopifyCurrency || "USD",
          transactionId: firstTransaction?.id
            ? `gid://shopify/Transaction/${firstTransaction.id}`
            : null,
          locationId: order.shopifyLocationId || order.store.shopifyLocationId,
          note: `Item returned - ${item.product?.title || "Unknown product"}`,
          notify: true,
          restockType: "RETURN",
        });
        console.log(`✅ Shopify refund created for item ${item.id}`);
      } catch (err) {
        console.error(`❌ Failed refund for item ${item.id}:`, err.message);
      }
    }
  }

  if (allStatuses.every((s) => s === "RETURNED")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "RETURNED" },
    });
    console.log(`↩️ Order ${orderId} fully returned`);
    return;
  }

  // ✅ All PACKED → COMPLETED
  if (allStatuses.every((s) => s === "FULFILLED")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "FULFILLED" },
    });

    console.log(`📦 Order ${orderId} completed, fulfilling in Shopify...`);
    const decryptedToken = decrypt(order.store.accessToken);

    // 🚚 Create Bosta delivery if store has Bosta API key configured
    if (order.store.bostaApiKey) {
      try {
        const { createBostaDelivery } = require("../services/bostaService");

        const bostaDelivery = await createBostaDelivery({
          bostaApiKey: order.store.bostaApiKey,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerEmail: order.customerEmail,
          address1: order.address1,
          address2: order.address2,
          province: order.province,
          orderNumber: order.orderNumber,
          totalPrice: order.totalPrice,
        });

        if (bostaDelivery) {
          await tx.order.update({
            where: { id: orderId },
            data: {
              bostaDeliveryId: bostaDelivery._id,
              bostaTrackingNumber: String(bostaDelivery.trackingNumber),
              deliveryStatus: "DELIVERY_CREATED",
            },
          });
          console.log(
            `✅ Bosta delivery created and linked to order ${orderId}: ${bostaDelivery._id}`
          );
        }
      } catch (err) {
        console.error(
          `❌ Failed to create Bosta delivery for order ${orderId}:`,
          err.message
        );
        // Continue with Shopify fulfillment even if Bosta fails
      }
    } else {
      console.log(
        `ℹ️ Store ${order.store.name} does not have Bosta API key configured, skipping Bosta delivery creation`
      );
    }

    try {
      await fulfillOrder(
        order.store.shopDomain,
        decryptedToken,
        order.shopifyId
      );
      console.log(`✅ Shopify fulfillment created for order ${orderId}`);
    } catch (err) {
      console.error(
        `❌ Failed to fulfill order in Shopify for order ${orderId}:`,
        err.message
      );
    }
    return;
  }

  // ✅ All CUT → FULFILLMENT
  if (allStatuses.every((s) => s === "CUT")) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "FULFILLMENT" },
    });
    return;
  }

  // 🧠 Find earliest active stage based on defined priority
  const statusPriority = [
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
    "RETURNED",
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
