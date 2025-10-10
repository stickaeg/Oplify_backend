// helpers/generateBatchQRCodes.js
const QRCode = require("qrcode");
const prisma = require("../prisma/client");
const crypto = require("crypto");

async function generateBatchQRCodes(batchId) {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        include: {
          units: true, // include the new batchItemUnit records
        },
      },
    },
  });

  if (!batch) throw new Error("Batch not found");

  // 🧾 Generate main batch QR (for printer)
  const batchToken = crypto.randomBytes(16).toString("hex");
  const batchQrUrl = await QRCode.toDataURL(
    `${process.env.HOST}/api/scan/batch/${batchToken}`
  );

  await prisma.batch.update({
    where: { id: batchId },
    data: { qrCodeToken: batchToken, qrCodeUrl: batchQrUrl },
  });

  // 🧩 Generate unit QRs (for cutting & fulfillment)
  const unitQRs = [];

  for (const item of batch.items) {
    for (const unit of item.units) {
      const token = crypto.randomBytes(16).toString("hex");

      const qrUrl = await QRCode.toDataURL(
        `${process.env.HOST}/api/scan/unit/${token}`
      );

      await prisma.batchItemUnit.update({
        where: { id: unit.id },
        data: { qrCodeToken: token, qrCodeUrl: qrUrl },
      });

      unitQRs.push({
        unitId: unit.id,
        itemId: item.id,
        qrUrl,
        token,
      });
    }
  }

  return {
    batchQrUrl,
    batchToken,
    unitQRs,
    unitCount: unitQRs.length,
  };
}

module.exports = generateBatchQRCodes;
