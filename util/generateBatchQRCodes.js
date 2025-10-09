// helpers/generateBatchQRCodes.js
const QRCode = require("qrcode");
const prisma = require("../prisma/client");
const crypto = require("crypto");

async function generateBatchQRCodes(batchId) {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });

  if (!batch) throw new Error("Batch not found");

  // Generate batch QR (for printer)
  const batchToken = crypto.randomBytes(16).toString("hex");
  const batchQrUrl = await QRCode.toDataURL(
    `${process.env.BACKEND_URL}/api/scan/batch/${batchToken}`
  );

  await prisma.batch.update({
    where: { id: batchId },
    data: { qrCodeToken: batchToken, qrCodeUrl: batchQrUrl },
  });

  // Generate item QRs (for cutter and fulfillment)
  const itemQRs = [];
  for (const item of batch.items) {
    const token = crypto.randomBytes(16).toString("hex");

    // For cutter (cutting phase)
    const qrUrl = await QRCode.toDataURL(
      `${process.env.BACKEND_URL}/api/scan/item/${token}`
    );

    await prisma.batchItem.update({
      where: { id: item.id },
      data: { qrCodeToken: token, qrCodeUrl: qrUrl },
    });

    itemQRs.push({ itemId: item.id, qrUrl, token });
  }

  return {
    batchQrUrl,
    batchToken,
    itemQRs,
    itemCount: batch.items.length,
  };
}

module.exports = generateBatchQRCodes;
