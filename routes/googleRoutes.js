const fs = require("fs");
const express = require("express");
const router = express.Router();
const {
  getFilesByBatch,
  downloadFile,
  uploadDesign,
} = require("../controllers/google.controllers");
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // temp storage

const prisma = require("../prisma/client");

const { requireRole } = require("../middleware/AuthMiddlewares");

const updateOrderStatusFromItems = require("../helpers/updateOrderStatusFromItems");

// List files
router.get("/files/:batchId", getFilesByBatch);

// Download file
router.get(
  "/download/:fileId",
  requireRole(["DESIGNER", "ADMIN", "PRINTER"]),
  downloadFile
);

// Upload multiple files
router.post(
  "/upload",
  requireRole(["DESIGNER", "ADMIN"]),
  upload.array("files", 10),
  async (req, res) => {
    const { files } = req;
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: "Batch ID is required" });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const uploadedFiles = [];

        // ✅ 1. Upload each file & create DB record
        for (const file of files) {
          const fileId = await uploadDesign(file.path, file.originalname);

          const createdFile = await tx.file.create({
            data: {
              name: file.originalname,
              fileId,
              mimeType: file.mimetype,
              size: file.size,
              status: "DESIGNED",
              batchId,
            },
          });

          uploadedFiles.push(createdFile);
          fs.unlinkSync(file.path); // cleanup temp file
        }

        // ✅ 2. Fetch the batch with items + order items
        const batch = await tx.batch.findUnique({
          where: { id: batchId },
          include: {
            items: {
              include: {
                orderItem: {
                  select: { id: true, orderId: true },
                },
                units: { select: { id: true } }, // include units to update them
              },
            },
          },
        });

        if (!batch) throw new Error("Batch not found");

        // ✅ 3. Update batch and related entities to DESIGNED
        await tx.batch.update({
          where: { id: batchId },
          data: { status: "DESIGNED" },
        });

        // ✅ 4. Update batch items
        await tx.batchItem.updateMany({
          where: { batchId },
          data: { status: "DESIGNED" },
        });

        // ✅ 5. Update units belonging to this batch
        const unitIds = batch.items.flatMap((item) =>
          item.units.map((u) => u.id)
        );

        if (unitIds.length > 0) {
          await tx.batchItemUnit.updateMany({
            where: { id: { in: unitIds } },
            data: { status: "DESIGNED" },
          });
        }

        // ✅ 6. Update related order items
        const orderItemIds = batch.items.map((item) => item.orderItemId);
        if (orderItemIds.length > 0) {
          await tx.orderItem.updateMany({
            where: { id: { in: orderItemIds } },
            data: { status: "DESIGNED" },
          });
        }

        // ✅ 7. Update parent orders
        const uniqueOrderIds = [
          ...new Set(batch.items.map((item) => item.orderItem.orderId)),
        ];
        for (const orderId of uniqueOrderIds) {
          await updateOrderStatusFromItems(orderId, tx);
        }

        console.log(
          `✅ Batch ${batchId}, ${batch.items.length} items, and ${unitIds.length} units marked as DESIGNED`
        );

        return { uploadedFiles, batch, unitCount: unitIds.length };
      });

      res.json({
        success: true,
        uploadedFiles: result.uploadedFiles,
        message: `${result.uploadedFiles.length} files uploaded. Batch, ${result.batch.items.length} items, and ${result.unitCount} units updated to DESIGNED.`,
      });
    } catch (error) {
      console.error("Upload error:", error);

      // Cleanup temp files on error
      if (files) {
        files.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }

      res.status(500).json({
        error: "Upload failed",
        details: error.message,
      });
    }
  }
);

module.exports = router;
