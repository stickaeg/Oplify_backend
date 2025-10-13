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
            units: true,
          },
        },
      },
    });

    if (!batch) return res.status(404).json({ error: "Batch not found" });

    // 🟩 Printer logic
    if (role === "PRINTER") {
      if (batch.status !== "PRINTING") {
        return res.status(400).json({
          error: `Cannot scan batch in status ${batch.status}. Expected PRINTING.`,
        });
      }

      const updatedBatch = await prisma.$transaction(async (tx) => {
        // Update the batch itself
        const updated = await tx.batch.update({
          where: { id: batch.id },
          data: { status: "PRINTED" },
        });

        // Update batch items
        await tx.batchItem.updateMany({
          where: { batchId: batch.id },
          data: { status: "PRINTED" },
        });

        // Update all batch item units
        await tx.batchItemUnit.updateMany({
          where: { batchItem: { batchId: batch.id } },
          data: { status: "PRINTED" },
        });

        // Update related order items
        const orderItemIds = batch.items.map((i) => i.orderItemId);
        await tx.orderItem.updateMany({
          where: { id: { in: orderItemIds } },
          data: { status: "PRINTED" },
        });

        // Update parent orders
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
        message: "Batch marked as PRINTED (including units)",
        batch: updatedBatch,
      });
    }

    // 🟦 Cutter logic
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
        });

        await tx.batchItem.updateMany({
          where: { batchId: batch.id },
          data: { status: "CUT" },
        });

        await tx.batchItemUnit.updateMany({
          where: { batchItem: { batchId: batch.id } },
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
        message: "Batch marked as CUT (including units)",
        batch: updatedBatch,
      });
    }
  } catch (err) {
    console.error("Batch scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// 🟦 SCAN ITEM QR (Fulfillment scans to mark as PACKED)
async function scanUnitFulfillment(req, res) {
  try {
    const { token } = req.params;
    const user = req.session.user;

    if (!user)
      return res.status(401).json({ error: "Unauthorized: Please log in" });
    if (user.role !== "FULFILLMENT")
      return res.status(403).json({ error: "Access denied: FULFILLMENT only" });

    // 🔍 Find the batch unit by QR token
    const unit = await prisma.batchItemUnit.findUnique({
      where: { qrCodeToken: token },
      include: {
        batchItem: {
          include: {
            batch: true,
            units: true,
            orderItem: {
              include: {
                order: {
                  include: {
                    items: {
                      include: {
                        product: true,
                        variant: true,
                        BatchItem: {
                          include: { units: true },
                        },
                      },
                    },
                  },
                },
                product: true,
                variant: true,
              },
            },
          },
        },
      },
    });

    if (!unit)
      return res.status(404).json({ error: "Invalid or unknown QR code" });

    const batchItem = unit.batchItem;
    const orderItem = batchItem.orderItem;
    const order = orderItem.order;

    // 🚫 Ensure this unit was already cut
    if (unit.status !== "CUT") {
      return res.status(400).json({ error: "Unit must be CUT before packing" });
    }

    // 🧩 Transactionally update statuses
    await prisma.$transaction(async (tx) => {
      // 1️⃣ Update the scanned unit
      await tx.batchItemUnit.update({
        where: { id: unit.id },
        data: { status: "PACKED" },
      });

      // 2️⃣ If all units in this BatchItem are packed → PACKED
      const allUnitsPacked = batchItem.units.every(
        (u) => u.id === unit.id || u.status === "PACKED"
      );
      if (allUnitsPacked) {
        await tx.batchItem.update({
          where: { id: batchItem.id },
          data: { status: "PACKED" },
        });
      }

      // 3️⃣ If all BatchItems for this orderItem are packed → PACKED
      const allItemUnitsPacked = orderItem.BatchItem.every((bi) =>
        bi.units.every((u) => (u.id === unit.id ? true : u.status === "PACKED"))
      );
      if (allItemUnitsPacked) {
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: { status: "PACKED" },
        });
      }

      // 4️⃣ If all orderItems are packed → COMPLETED
      const allItemsPacked = order.items.every(
        (item) => item.id === orderItem.id || item.status === "PACKED"
      );
      if (allItemsPacked) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "COMPLETED" },
        });
      }
    });

    // ✅ Fetch updated order with all details
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            product: { select: { id: true, title: true, imgUrl: true } },
            variant: { select: { id: true, title: true, sku: true } },
            BatchItem: {
              include: {
                units: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
    });

    // ✅ Respond with success + full order details
    return res.json({
      message: "Unit packed successfully",
      order: updatedOrder,
    });
  } catch (err) {
    console.error("❌ Fulfillment scan error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  scanBatch,
  scanUnitFulfillment,
};
