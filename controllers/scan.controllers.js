// controllers/scan.controllers.js
const prisma = require("../prisma/client");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");

// 🟩 SCAN BATCH QR (Printer)
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

    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (role !== "PRINTER")
      return res
        .status(403)
        .json({ error: "Only printers can scan this batch" });

    if (batch.status !== "PRINTING") {
      return res.status(400).json({
        error: `Cannot scan batch in status ${batch.status}`,
      });
    }

    // Transaction: mark batch + items + orderItems as PRINTED
    const updatedBatch = await prisma.$transaction(async (tx) => {
      const updatedBatch = await tx.batch.update({
        where: { id: batch.id },
        data: { status: "PRINTED" },
        include: { items: true },
      });

      // Update all batch items
      await tx.batchItem.updateMany({
        where: { batchId: batch.id },
        data: { status: "PRINTED" },
      });

      // Update related order items
      const orderItemIds = batch.items.map((i) => i.orderItemId);
      await tx.orderItem.updateMany({
        where: { id: { in: orderItemIds } },
        data: { status: "PRINTED" },
      });

      // Update each order's overall status
      const uniqueOrderIds = [
        ...new Set(batch.items.map((i) => i.orderItem.orderId)),
      ];
      for (const orderId of uniqueOrderIds) {
        await updateOrderStatusFromItems(orderId, tx);
      }

      return updatedBatch;
    });

    console.log(`✅ Printer ${userId} marked batch ${batch.name} as PRINTED`);

    return res.json({
      success: true,
      message: "Batch marked as PRINTED",
      batch: updatedBatch,
    });
  } catch (err) {
    console.error("Batch scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 🟨 SCAN UNIT QR (Cutter scans stickers to mark as CUT)
async function scanUnitCutter(req, res) {
  try {
    const { token } = req.params;
    const userId = req.session.userId;
    const role = req.session.role;

    if (!userId) return res.redirect(`${process.env.FRONTEND_URL}/login`);
    if (!["CUTTER", "PRINTER"].includes(role))
      return res.redirect(`${process.env.FRONTEND_URL}/error`);

    // 🔍 Find the unit by QR token
    const unit = await prisma.batchItemUnit.findFirst({
      where: { qrCodeToken: token },
      include: {
        batchItem: {
          include: {
            units: true,
            orderItem: {
              include: {
                order: { select: { id: true, orderNumber: true } },
                product: { select: { title: true } },
              },
            },
            batch: {
              include: {
                items: {
                  include: { units: true },
                },
              },
            },
          },
        },
      },
    });

    if (!unit) return res.redirect(`${process.env.FRONTEND_URL}`);

    const { batchItem } = unit;

    // 🧩 Transaction to handle atomic updates
    await prisma.$transaction(async (tx) => {
      if (role === "PRINTER") {
        // 🖨️ PRINTER logic: mark unit as PRINTED
        if (unit.status !== "PRINTING") {
          return res.redirect(`${process.env.FRONTEND_URL}/error`);
        }

        await tx.batchItemUnit.update({
          where: { id: unit.id },
          data: { status: "PRINTED" },
        });

        const allUnitsPrinted = batchItem.units.every(
          (u) => u.id === unit.id || u.status === "PRINTED"
        );

        if (allUnitsPrinted) {
          await tx.batchItem.update({
            where: { id: batchItem.id },
            data: { status: "PRINTED" },
          });

          await tx.orderItem.update({
            where: { id: batchItem.orderItemId },
            data: { status: "PRINTED" },
          });

          await updateOrderStatusFromItems(batchItem.orderItem.order.id, tx);
        }

        // ✅ If all items in batch are PRINTED, update batch
        const allItemsPrinted = batchItem.batch.items.every((item) =>
          item.units.every((unit) => unit.status === "PRINTED")
        );

        if (allItemsPrinted) {
          await tx.batch.update({
            where: { id: batchItem.batch.id },
            data: { status: "PRINTED" },
          });
        }

        console.log(`🖨️ Printer ${userId} marked unit ${unit.id} as PRINTED`);
      }

      if (role === "CUTTER") {
        // ✂️ CUTTER logic: only proceed if item/batch already PRINTED
        if (
          batchItem.status !== "PRINTED" &&
          batchItem.batch.status !== "PRINTED"
        ) {
          return res.redirect(`${process.env.FRONTEND_URL}/error`);
        }

        await tx.batchItemUnit.update({
          where: { id: unit.id },
          data: { status: "CUT" },
        });

        const allUnitsCut = batchItem.units.every(
          (u) => u.id === unit.id || u.status === "CUT"
        );

        if (allUnitsCut) {
          await tx.batchItem.update({
            where: { id: batchItem.id },
            data: { status: "CUT" },
          });

          await tx.orderItem.update({
            where: { id: batchItem.orderItemId },
            data: { status: "CUT" },
          });

          await updateOrderStatusFromItems(batchItem.orderItem.order.id, tx);
        }

        // ✅ If all items in batch are CUT, update batch
        const allItemsCut = batchItem.batch.items.every((item) =>
          item.units.every((unit) => unit.status === "CUT")
        );

        if (allItemsCut) {
          await tx.batch.update({
            where: { id: batchItem.batch.id },
            data: { status: "CUT" },
          });
          console.log(`✅ All units in batch ${batchItem.batch.name} are CUT`);
        }

        console.log(`✂️ Cutter ${userId} marked unit ${unit.id} as CUT`);
      }
    });

    // ✅ Redirect back to batch details
    return res.redirect(
      `${process.env.FRONTEND_URL}/batches/${batchItem.batchId}`
    );
  } catch (err) {
    console.error("Unit scan error:", err);
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
  scanUnitCutter,
  scanItemFulfillment,
};
