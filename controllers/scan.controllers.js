// controllers/scan.controllers.js
const prisma = require("../prisma/client");
const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");

// 🟩 SCAN BATCH QR (Printer)
async function scanBatch(req, res) {
  try {
    const { token } = req.params;
    const userId = req.session.userId;
    const role = req.session.role;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!["PRINTER", "CUTTER"].includes(role))
      return res.status(403).json({ error: "Invalid role for scanning" });

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

    // 🟩 PRINTER logic — mark as PRINTED
    if (role === "PRINTER") {
      if (batch.status !== "PRINTING") {
        return res.status(400).json({
          error: `Cannot scan batch in status ${batch.status}. Expected PRINTING.`,
        });
      }

      const updatedBatch = await prisma.$transaction(async (tx) => {
        const updated = await tx.batch.update({
          where: { id: batch.id },
          data: { status: "PRINTED" },
          include: { items: true },
        });

        await tx.batchItem.updateMany({
          where: { batchId: batch.id },
          data: { status: "PRINTED" },
        });

        const orderItemIds = batch.items.map((i) => i.orderItemId);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: "PRINTED" },
        });

        const uniqueOrderIds = [
          ...new Set(batch.items.map((i) => i.orderItem.orderId)),
        ];
        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }

        return updated;
      });

      console.log(`🖨️ Printer ${userId} marked batch ${batch.id} as PRINTED`);
      return res.json({
        success: true,
        message: "Batch marked as PRINTED",
        batch: updatedBatch,
      });
    }

    // 🟦 CUTTER logic — mark as CUT
    if (role === "CUTTER") {
      if (batch.status !== "PRINTED") {
        return res.status(400).json({
          error: `Cannot scan batch in status ${batch.status}. Expected PRINTED.`,
        });
      }

      const updatedBatch = await prisma.$transaction(async (tx) => {
        const updated = await tx.batch.update({
          where: { id: batch.id },
          data: { status: "CUT" },
          include: { items: true },
        });

        await tx.batchItem.updateMany({
          where: { batchId: batch.id },
          data: { status: "CUT" },
        });

        const orderItemIds = batch.items.map((i) => i.orderItemId);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: "CUT" },
        });

        const uniqueOrderIds = [
          ...new Set(batch.items.map((i) => i.orderItem.orderId)),
        ];
        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }

        return updated;
      });

      console.log(`✂️ Cutter ${userId} marked batch ${batch.id} as CUT`);
      return res.json({
        success: true,
        message: "Batch marked as CUT",
        batch: updatedBatch,
      });
    }
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

    if (!userId)
      return res.status(401).json({ error: "Unauthorized: Please log in" });

    if (!["CUTTER", "PRINTER"].includes(role))
      return res.status(403).json({ error: "Access denied" });

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
              include: { items: { include: { units: true } } },
            },
          },
        },
      },
    });

    if (!unit) return res.status(404).json({ error: "Unit not found" });

    const { batchItem } = unit;
    let updatedStatus = null;

    await prisma.$transaction(async (tx) => {
      // 🖨️ PRINTER logic
      if (role === "PRINTER") {
        if (unit.status !== "PRINTING") {
          throw new Error("Unit is not ready for printing");
        }

        await tx.batchItemUnit.update({
          where: { id: unit.id },
          data: { status: "PRINTED" },
        });
        updatedStatus = "PRINTED";

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

      // ✂️ CUTTER logic
      if (role === "CUTTER") {
        const freshUnit = await tx.batchItemUnit.findUnique({
          where: { id: unit.id },
          select: { status: true },
        });

        if (freshUnit.status !== "PRINTED") {
          throw new Error("Unit must be PRINTED before cutting");
        }

        await tx.batchItemUnit.update({
          where: { id: unit.id },
          data: { status: "CUT" },
        });
        updatedStatus = "CUT";

        // Count remaining non-CUT units for this batch item
        const remainingUnits = await tx.batchItemUnit.count({
          where: {
            batchItemId: batchItem.id,
            status: { not: "CUT" },
          },
        });

        if (remainingUnits === 0) {
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

        // Count remaining non-CUT units across all items in batch
        const remainingBatchUnits = await tx.batchItemUnit.count({
          where: {
            batchItem: { batchId: batchItem.batchId },
            status: { not: "CUT" },
          },
        });

        if (remainingBatchUnits === 0) {
          await tx.batch.update({
            where: { id: batchItem.batchId },
            data: { status: "CUT" },
          });
        }

        console.log(`✂️ Cutter ${userId} marked unit ${unit.id} as CUT`);
      }
    });

    return res.status(200).json({
      success: true,
      message: `${role} marked unit as ${updatedStatus}`,
      unitId: unit.id,
      newStatus: updatedStatus,
      batchItemId: batchItem.id,
      batchId: batchItem.batchId,
    });
  } catch (err) {
    console.error("❌ Unit scan error:", err);
    return res.status(400).json({ success: false, error: err.message });
  }
}

// 🟦 SCAN ITEM QR (Fulfillment scans to mark as PACKED)

async function scanItemFulfillment(req, res) {
  try {
    const { token } = req.params;
    const user = req.session.user;

    if (!user) {
      return res.redirect(`${process.env.FRONTEND_URL}/`);
    }

    if (user.role !== "FULFILLMENT") {
      return res.redirect(`${process.env.FRONTEND_URL}/`);
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
