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
      // ✅ Use transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        const uploadedFiles = [];

        // Upload files to storage and create records
        for (const file of files) {
          const fileId = await uploadDesign(file.path, file.originalname);

          const createdFile = await tx.file.create({
            data: {
              name: file.originalname,
              fileId,
              mimeType: file.mimetype,
              size: file.size,
              status: "DESIGNED", // ✅ Changed from PENDING to DESIGNED
              batchId,
            },
          });

          uploadedFiles.push(createdFile);
          fs.unlinkSync(file.path); // Clean up temp file
        }

        // ✅ Get batch with all related items
        const batch = await tx.batch.findUnique({
          where: { id: batchId },
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
          throw new Error("Batch not found");
        }

        // ✅ Update batch status to DESIGNED
        await tx.batch.update({
          where: { id: batchId },
          data: { status: "DESIGNED" },
        });

        // ✅ Update all batch items to DESIGNED
        if (batch.items.length > 0) {
          await tx.batchItem.updateMany({
            where: { batchId: batchId },
            data: { status: "DESIGNED" },
          });

          // ✅ Update all related order items to DESIGNED
          const orderItemIds = batch.items.map((item) => item.orderItemId);
          await tx.orderItem.updateMany({
            where: { id: { in: orderItemIds } },
            data: { status: "DESIGNED" },
          });

          // ✅ Update parent orders
          const uniqueOrderIds = [
            ...new Set(batch.items.map((item) => item.orderItem.orderId)),
          ];

          for (const orderId of uniqueOrderIds) {
            await updateOrderStatusFromItems(orderId, tx);
          }
        }

        console.log(
          `✅ Batch ${batchId} and ${batch.items.length} items marked as DESIGNED`
        );

        return { uploadedFiles, batch };
      });

      // ✅ Generate QR codes AFTER transaction completes
      res.json({
        success: true,
        uploadedFiles: result.uploadedFiles,
        message: `${result.uploadedFiles.length} files uploaded, batch and ${result.batch.items.length} items updated to DESIGNED`,
      });
    } catch (error) {
      console.error("Upload error:", error);

      // Clean up any uploaded files on error
      if (files) {
        files.forEach((file) => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
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
