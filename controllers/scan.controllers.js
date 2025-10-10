// controllers/scan.controllers.js
const prisma = require("../prisma/client");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");

async function scanBatch(req, res) {
  try {
    const { token } = req.params;
    const userId = req.session.userId;
    const role = req.session.role;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const batch = await prisma.batch.findFirst({
      where: { qrCodeToken: token },
      include: {
        items: {
          include: {
            orderItem: { select: { id: true, orderId: true } },
          },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    if (role !== "PRINTER") {
      return res
        .status(403)
        .json({ error: "Only printers can scan this batch" });
    }

    // Only allow scanning if batch is in PRINTING status
    if (batch.status !== "PRINTING") {
      return res
        .status(400)
        .json({ error: `Cannot scan batch in status ${batch.status}` });
    }

    // Update batch, items, and order items in a transaction
    const updatedBatch = await prisma.$transaction(async (tx) => {
      const updatedBatch = await tx.batch.update({
        where: { id: batch.id },
        data: { status: "PRINTED" },
        include: { items: true },
      });

      if (batch.items.length > 0) {
        await tx.batchItem.updateMany({
          where: { batchId: batch.id },
          data: { status: "PRINTED" },
        });

        const orderItemIds = batch.items.map((item) => item.orderItemId);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: "PRINTED" },
        });

        const uniqueOrderIds = [
          ...new Set(batch.items.map((item) => item.orderItem.orderId)),
        ];
        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }
      }

      return updatedBatch;
    });

    console.log(`✅ Printer ${userId} marked batch ${batch.name} as PRINTED`);

    // ✅ Return updated batch instead of redirect
    return res.json({
      success: true,
      message: `Batch marked as PRINTED`,
      batch: updatedBatch,
    });
  } catch (err) {
    console.error("Batch scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 🟨 SCAN ITEM QR (Cutter scans individual stickers to mark as CUT)
async function scanItemCutter(req, res) {
  try {
    const { token } = req.params;
    const userId = req.session.userId;
    const role = req.session.role;

    if (!userId) return res.redirect(`${process.env.FRONTEND_URL}/login`);
    if (role !== "CUTTER")
      return res.redirect(`${process.env.FRONTEND_URL}/error`);

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
          include: {
            items: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!batchItem) return res.redirect(`${process.env.FRONTEND_URL}`);

    if (
      batchItem.status !== "PRINTED" &&
      batchItem.batch.status !== "PRINTED"
    ) {
      return res.redirect(`${process.env.FRONTEND_URL}/error`);
    }

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
