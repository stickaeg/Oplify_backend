// const { google } = require("googleapis");
// const fs = require("fs");
// const path = require("path");
// const mime = require("mime-types"); // optional, for automatic MIME detection

// // Path to your service account key (in the same folder)
// const KEYFILEPATH = path.join(__dirname, "crm_account_services.json");

// // Google Drive folder ID
// const FOLDER_ID = "15Ov9nCA4hkOkMV4KfYOrDiFW2vBojmS9";

// // Authenticate with service account
// const auth = new google.auth.GoogleAuth({
//   keyFile: KEYFILEPATH,
//   scopes: ["https://www.googleapis.com/auth/drive"],
// });

// const drive = google.drive({ version: "v3", auth });

// // Function to upload a file
// async function uploadDesign(filePath, fileName) {
//   try {
//     // Auto-detect MIME type
//     const mimeType = mime.lookup(filePath) || "application/octet-stream";

//     const response = await drive.files.create({
//       requestBody: {
//         name: fileName,
//         parents: [FOLDER_ID],
//       },
//       media: {
//         mimeType,
//         body: fs.createReadStream(filePath),
//       },
//     });

//     console.log("File uploaded successfully! File ID:", response.data.id);
//     return response.data.id;
//   } catch (error) {
//     console.error("Error uploading file:", error.message);
//   }
// }
