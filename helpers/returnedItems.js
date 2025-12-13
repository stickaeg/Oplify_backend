const prisma = require("../prisma/client");

// Core helper that works WITH an existing transaction client
async function createReturnedItemWithTx(tx, params) {
  const orderItemId = params.orderItemId;
  const quantity = params.quantity;
  const reason = params.reason || null;

  // 1) Load the order item and its relations
  const orderItem = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: {
      order: true,
      product: true,
      variant: true,
    },
  });

  if (!orderItem) {
    throw new Error("OrderItem " + orderItemId + " not found");
  }

  if (quantity <= 0) {
    throw new Error("Return quantity must be > 0");
  }

  if (quantity > orderItem.quantity) {
    throw new Error(
      "Return quantity (" +
        quantity +
        ") cannot exceed ordered quantity (" +
        orderItem.quantity +
        ")"
    );
  }

  // 2) Create the ReturnedItem row
  const returnedItem = await tx.returnedItem.create({
    data: {
      orderItemId: orderItem.id,
      orderId: orderItem.orderId,
      productId: orderItem.productId,
      variantId: orderItem.variantId,
      storeId: orderItem.order.storeId,
      quantity: quantity,
      reason: reason,
    },
  });

  return returnedItem;
}

// Optional wrapper if you ever want to call it OUTSIDE an existing tx
async function createReturnedItem(params) {
  return prisma.$transaction(function (tx) {
    return createReturnedItemWithTx(tx, params);
  });
}

module.exports = {
  createReturnedItem,
  createReturnedItemWithTx,
};
