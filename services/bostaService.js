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
 * @param {Array} params.orderItems - Array of order items to calculate items count
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
  isPrepaid,
  orderItems = [],
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

    // Calculate COD amount: 0 for prepaid orders, totalPrice for COD orders
    const codAmount = isPrepaid ? 0 : (totalPrice || 0);

    // Calculate items count dynamically from order items
    const itemsCount = orderItems.length || 1;

    console.log(
      `💵 Order ${orderNumber} - Payment: ${isPrepaid ? "PREPAID (Visa/Card)" : "COD"}, COD Amount: ${codAmount} EGP, Items: ${itemsCount}`
    );

    // Prepare Bosta delivery payload
    const deliveryPayload = {
      type: "SEND",
      specs: {
        packageType: "Parcel",
        size: "SMALL",
        packageDetails: {
          itemsCount,
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
      cod: codAmount,
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
      `✅ Bosta delivery created for order ${orderNumber}:`,
      bostaResponse.data?._id
    );

    return bostaResponse.data;
  } catch (err) {
    console.error(
      `❌ Failed to create Bosta delivery for order ${orderNumber}:`,
      err.message
    );
    return null;
  }
}

/**
 * Cancel a Bosta delivery via API
 * @param {Object} params - Cancellation parameters
 * @param {string} params.bostaApiKey - Encrypted Bosta API key
 * @param {string} params.bostaDeliveryId - Bosta delivery ID to cancel
 * @param {number} params.orderNumber - Order number for logging reference
 * @returns {Promise<boolean>} true if cancelled successfully, false on failure
 */
async function cancelBostaDelivery({
  bostaApiKey,
  bostaDeliveryId,
  orderNumber,
}) {
  try {
    // Decrypt the API key
    const apiKey = decrypt(bostaApiKey);

    // Validate required fields
    if (!bostaDeliveryId) {
      console.warn(
        `⚠️ Cannot cancel Bosta delivery for order ${orderNumber}: missing delivery ID`
      );
      return false;
    }

    console.log(
      `🛑 Cancelling Bosta delivery ${bostaDeliveryId} for order ${orderNumber}...`
    );

    // Call Bosta API to cancel delivery
    // Using DELETE method as per REST API standard pattern
    const response = await fetch(
      `https://app.bosta.co/api/v2/deliveries/${bostaDeliveryId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ Bosta API error cancelling delivery for order ${orderNumber}:`,
        response.status,
        errorText
      );
      return false;
    }

    console.log(
      `✅ Bosta delivery ${bostaDeliveryId} cancelled successfully for order ${orderNumber}`
    );

    return true;
  } catch (err) {
    console.error(
      `❌ Failed to cancel Bosta delivery for order ${orderNumber}:`,
      err.message
    );
    return false;
  }
}

module.exports = {
  createBostaDelivery,
  cancelBostaDelivery,
};
