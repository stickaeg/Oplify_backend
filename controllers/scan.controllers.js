// controllers/scan.controllers.js
const prisma = require("../prisma/client");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");

// 🟩 SCAN BATCH QR (Printer scans to mark as PRINTED)
async function scanBatch(req, res) {
  try {
    const { token } = req.params;
    const userId = req.session.userId;
    const role = req.session.role;

    // ✅ Check if user is logged in
    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL}`);
    }

    // ✅ Find batch by token
    const batch = await prisma.batch.findFirst({
      where: { qrCodeToken: token },
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

    if (!batch) {
      return res.redirect(`${process.env.FRONTEND_URL}/error`);
    }

    let newStatus;

    // ✅ Role-based status logic
    if (role === "PRINTER") {
      if (batch.status !== "PRINTING") {
        return res.redirect(`${process.env.FRONTEND_URL}/batches/${batch.id}?`);
      }
      newStatus = "PRINTED";
    } else {
      return res.redirect(`${process.env.FRONTEND_URL}/error`);
    }

    // ✅ Update batch, items, and order items in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.batch.update({
        where: { id: batch.id },
        data: { status: newStatus },
      });

      if (batch.items.length > 0) {
        await tx.batchItem.updateMany({
          where: { batchId: batch.id },
          data: { status: newStatus },
        });

        const orderItemIds = batch.items.map((item) => item.orderItemId);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: newStatus },
        });

        const uniqueOrderIds = [
          ...new Set(batch.items.map((item) => item.orderItem.orderId)),
        ];

        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }
      }
    });

    console.log(`✅ Printer ${userId} marked batch ${batch.name} as PRINTED`);

    // ✅ Redirect to frontend batch page after success
    return res.redirect(
      `${process.env.FRONTEND_URL}/batches/${batch.id}?scan=success&status=PRINTED`
    );
  } catch (err) {
    console.error("Batch scan error:", err);
    return res.redirect(`${process.env.FRONTEND_URL}/error`);
  }
}

// 🟨 SCAN ITEM QR (Cutter scans individual stickers to mark as CUT)
async function scanItemCutter(req, res) {
  try {
    const { token } = req.params;
    const userId = req.session.userId;
    const role = req.session.role;

    // ✅ Check if user is logged in
    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL}/login`);
    }

    // ✅ Role-based access
    if (role !== "CUTTER") {
      return res.redirect(`${process.env.FRONTEND_URL}/error`);
    }

    // ✅ Find batch item by token
    const batchItem = await prisma.batchItem.findFirst({
      where: { qrCodeToken: token },
      include: {
        orderItem: {
          include: {
            order: { select: { id: true, orderNumber: true } },
            product: { select: { title: true } },
          },
        },
        batch: {
          select: { id: true, name: true, status: true },
          include: {
            items: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!batchItem) {
      return res.redirect(`${process.env.FRONTEND_URL}`);
    }

    // ✅ Ensure batch/item is PRINTED before cutting
    if (
      batchItem.status !== "PRINTED" &&
      batchItem.batch.status !== "PRINTED"
    ) {
      return res.redirect(`${process.env.FRONTEND_URL}/error`);
    }

    // ✅ Update item status to CUT in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.batchItem.update({
        where: { id: batchItem.id },
        data: { status: "CUT" },
      });

      await tx.orderItem.update({
        where: { id: batchItem.orderItemId },
        data: { status: "CUT" },
      });

      await updateOrderStatusFromItems(batchItem.orderItem.order.id, tx);

      // ✅ Check if all items in batch are now CUT
      const allItems = batchItem.batch.items;
      const allCut = allItems.every((item) =>
        item.id === batchItem.id ? true : item.status === "CUT"
      );

      if (allCut) {
        await tx.batch.update({
          where: { id: batchItem.batch.id },
          data: { status: "CUT" },
        });
        console.log(`✅ All items in batch ${batchItem.batch.name} are CUT`);
      }
    });

    console.log(`✅ Cutter ${userId} marked item ${batchItem.id} as CUT`);

    // ✅ Redirect to frontend batch page
    return res.redirect(
      `${process.env.FRONTEND_URL}/batches/${batchItem.batchId}`
    );
  } catch (err) {
    console.error("Item scan error:", err);
    return res.redirect(`${process.env.FRONTEND_URL}/error`);
  }
}

// 🟦 SCAN ITEM QR (Fulfillment scans to mark as PACKED)
async function scanItemFulfillment(req, res) {
  try {
    const { token } = req.params;
    const user = req.session.user;

    if (!user) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?redirect=/api/scan/item-fulfillment/${token}`
      );
    }

    if (user.role !== "FULFILLMENT") {
      return res.redirect(
        `${process.env.FRONTEND_URL}/error?message=Only fulfillment can scan for packing`
      );
    }

    const batchItem = await prisma.batchItem.findFirst({
      where: { qrCodeToken: token },
      include: {
        orderItem: {
          include: {
            order: {
              select: { id: true, orderNumber: true },
              include: {
                items: { select: { id: true, status: true } },
              },
            },
            product: { select: { title: true, imgUrl: true } },
            variant: { select: { title: true, sku: true } },
          },
        },
        batch: { select: { id: true, name: true } },
      },
    });

    if (!batchItem) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/error?message=Invalid item QR`
      );
    }

    if (batchItem.status !== "CUT") {
      return res.redirect(
        `${process.env.FRONTEND_URL}/error?message=Item must be CUT before packing`
      );
    }

    // Update item to PACKED
    await prisma.$transaction(async (tx) => {
      await tx.batchItem.update({
        where: { id: batchItem.id },
        data: { status: "PACKED" },
      });

      await tx.orderItem.update({
        where: { id: batchItem.orderItemId },
        data: { status: "PACKED" },
      });

      await updateOrderStatusFromItems(batchItem.orderItem.order.id, tx);

      // ✅ Check if all items in order are PACKED
      const allItems = batchItem.orderItem.order.items;
      const allPacked = allItems.every((item) =>
        item.id === batchItem.orderItemId ? true : item.status === "PACKED"
      );

      if (allPacked) {
        await tx.order.update({
          where: { id: batchItem.orderItem.order.id },
          data: { status: "COMPLETED" },
        });
        console.log(
          `✅ Order ${batchItem.orderItem.order.orderNumber} is COMPLETED`
        );
      }
    });

    console.log(
      `✅ Fulfillment ${user.name} marked item ${batchItem.id} as PACKED`
    );

    // Redirect to order page
    return res.redirect(
      `${process.env.FRONTEND_URL}/orders/${batchItem.orderItem.order.id}?scan=success&itemPacked=${batchItem.id}`
    );
  } catch (err) {
    console.error("Fulfillment scan error:", err);
    return res.redirect(
      `${process.env.FRONTEND_URL}/error?message=Server error`
    );
  }
}

module.exports = {
  scanBatch,
  scanItemCutter,
  scanItemFulfillment,
};
