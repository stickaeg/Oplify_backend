const { decrypt } = require("../lib/crypto");

/**
 * Create a Bosta delivery via API
 * @param {Object} params - Delivery parameters
 * @param {string} params.bostaApiKey - Encrypted Bosta API key
 * @param {string} params.customerName - Customer full name
 * @param {string} params.customerPhone - Customer phone number (required)
 * @param {string} params.customerEmail - Customer email
 * @param {string} params.address1 - Primary address line
 * @param {string} params.address2 - Secondary address line
 * @param {string} params.province - City/Governorate
 * @param {number} params.orderNumber - Order number for reference
 * @param {number} params.totalPrice - Total order price (for COD if applicable)
 * @returns {Promise<Object|null>} Bosta delivery response with _id and trackingNumber, or null on failure
 */
async function createBostaDelivery({
  bostaApiKey,
  customerName,
  customerPhone,
  customerEmail,
  address1,
  address2,
  province,
  orderNumber,
  totalPrice,
}) {
  try {
    // Decrypt the API key
    const apiKey = decrypt(bostaApiKey);

    // Validate required fields
    if (!customerPhone || !address1 || !province) {
      console.warn(
        `⚠️ Cannot create Bosta delivery for order ${orderNumber}: missing required fields (phone, address, or city)`
      );
      return null;
    }

    // Split customer name into first/last
    const nameParts = (customerName || "Customer").trim().split(" ");
    const firstName = nameParts[0] || "Customer";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Prepare Bosta delivery payload
    const deliveryPayload = {
      type: "SEND",
      specs: {
        packageType: "Parcel",
        size: "SMALL",
        packageDetails: {
          itemsCount: 1, // You can adjust this based on order items if needed
        },
      },
      dropOffAddress: {
        firstLine: address1,
        secondLine: address2 || "",
        city: province,
        phone: customerPhone,
      },
      receiver: {
        firstName,
        lastName,
        phone: customerPhone,
        email: customerEmail || "",
      },
      webhookUrl: `${process.env.HOST}/webhooks/bosta`,
      businessReference: String(orderNumber || ""),
    };

    console.log(
      `📦 Creating Bosta delivery for order ${orderNumber}...`,
      JSON.stringify(deliveryPayload, null, 2)
    );

    // Call Bosta API
    const response = await fetch("https://app.bosta.co/api/v2/deliveries", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deliveryPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ Bosta API error for order ${orderNumber}:`,
        response.status,
        errorText
      );
      return null;
    }

    const bostaResponse = await response.json();

    console.log(
      `✅ Bosta delivery created for order ${orderNumber}. Full Response:`,
      JSON.stringify(bostaResponse, null, 2)
    );

    console.log(
      `✅ Bosta delivery created for order ${orderNumber}:`,
      bostaResponse._id
    );

    return bostaResponse;
  } catch (err) {
    console.error(
      `❌ Failed to create Bosta delivery for order ${orderNumber}:`,
      err.message
    );
    return null;
  }
}

module.exports = {
  createBostaDelivery,
};
