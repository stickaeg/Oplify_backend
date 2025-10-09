const { Storage } = require("@google-cloud/storage");
const mime = require("mime-types");
const prisma = require("../prisma/client");

const BUCKET_NAME = "oplify";

// Use JSON credentials from environment
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );

  storage = new Storage({
    credentials,
    projectId: credentials.project_id, // 🟢 required in some cases
  });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Fallback: local file for dev
  storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
} else {
  // Fallback: default credentials (if using Google Cloud runtime)
  storage = new Storage();
}
const bucket = storage.bucket(BUCKET_NAME);

// Upload a file
const uploadDesign = async (filePath, fileName) => {
  try {
    const mimeType = mime.lookup(filePath) || "application/octet-stream";

    await bucket.upload(filePath, {
      destination: fileName,
      metadata: {
        contentType: mimeType,
      },
    });

    return fileName; // Return the file name as identifier
  } catch (error) {
    console.error("Upload error:", error.message);
    throw error;
  }
};

const getFilesByBatch = async (req, res) => {
  const { batchId } = req.params;

  try {
    // ✅ Fetch only files linked to this batch
    const files = await prisma.file.findMany({
      where: { batchId },
      orderBy: { createdAt: "desc" },
    });

    res.json(files);
  } catch (error) {
    console.error("Error fetching batch files:", error);
    res.status(500).json({ error: "Failed to fetch batch files" });
  }
};

// Download a file by name
const downloadFile = async (req, res) => {
  try {
    const { fileId } = req.params;

    // 1️⃣ Get the file record from DB
    const fileRecord = await prisma.File.findUnique({
      where: { id: fileId },
    });

    if (!fileRecord) {
      return res.status(404).json({ error: "File record not found in DB" });
    }

    const gcsFileName = fileRecord.fileId; // this is your GCS filename
    if (!gcsFileName) {
      return res.status(400).json({ error: "No GCS filename specified" });
    }

    const file = bucket.file(gcsFileName);

    // 2️⃣ Check if it exists
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: "File not found in bucket" });
    }

    // 3️⃣ Get metadata
    const [metadata] = await file.getMetadata();

    // 4️⃣ Set headers
    res.setHeader(
      "Content-Type",
      metadata.contentType || "application/octet-stream"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileRecord.name}"`
    );

    // 5️⃣ Stream the file
    file.createReadStream().pipe(res);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Failed to download file" });
  }
};

module.exports = {
  uploadDesign,
  downloadFile,
  getFilesByBatch,
};
