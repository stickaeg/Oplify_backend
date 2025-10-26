const prisma = require("../prisma/client");

const { assignOrderItemsToBatches } = require("../helpers/batchHelper");

async function handleProductCreate(req, res) {
  try {
    const shopifyProduct = req.body;
    const shopifyId = String(shopifyProduct.admin_graphql_api_id);
    const storeId = req.store.id;

    const title = shopifyProduct.title || "";
    const productType = shopifyProduct.product_type || null;
    const imgUrl = shopifyProduct.images?.[0]?.src || null;

    // Find matching rule for the product type if it exists
    let isPod = false;
    if (productType) {
      const rule = await prisma.productTypeRule.findFirst({
        where: { name: { equals: productType, mode: "insensitive" } },
      });
      if (rule) {
        isPod = rule.isPod;
      }
    }

    // Use upsert to handle cases where product might already exist
    const product = await prisma.product.upsert({
      where: {
        shopifyId_storeId: {
          shopifyId,
          storeId,
        },
      },
      update: {
        title,
        productType,
        imgUrl,
        isPod,
      },
      create: {
        shopifyId,
        storeId,
        title,
        productType,
        imgUrl,
        isPod,
      },
    });

    console.log(`✅ Created product ${shopifyId} in DB`);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error creating product:", err);
    res.sendStatus(500);
  }
}

async function handleProductUpdate(req, res) {
  try {
    const shopifyProduct = req.body;
    const shopifyId = String(shopifyProduct.admin_graphql_api_id);
    const storeId = req.store.id;

    const title = shopifyProduct.title || "";
    const productType = shopifyProduct.product_type || null;
    const imgUrl = shopifyProduct.images?.[0]?.src || null;

    // Find matching rule for the product type if it exists
    let isPod = false;
    if (productType) {
      const rule = await prisma.productTypeRule.findFirst({
        where: { name: { equals: productType, mode: "insensitive" } },
      });
      if (rule) {
        isPod = rule.isPod;
      }
    }

    const updatedProduct = await prisma.product.updateMany({
      where: {
        shopifyId,
        storeId,
      },
      data: {
        title,
        productType,
        imgUrl,
        isPod,
      },
    });

    if (updatedProduct.count === 0) {
      console.log("⚠️ Product not found in DB. Consider creating it.");
    } else {
      console.log(`✅ Updated product ${shopifyId} in DB`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error updating product:", err);
    res.sendStatus(500);
  }
}

async function handleProductDelete(req, res) {
  try {
    const shopifyProduct = req.body;
    const shopifyId = String(shopifyProduct.admin_graphql_api_id);
    const storeId = req.store.id;

    const deletedProduct = await prisma.product.deleteMany({
      where: {
        shopifyId,
        storeId,
      },
    });

    if (deletedProduct.count === 0) {
      console.log("⚠️ Product not found in DB for deletion");
    } else {
      console.log(`✅ Deleted product ${shopifyId} from DB`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error deleting product:", err);
    res.sendStatus(500);
  }
}

async function handleOrderCreate(req, res) {
  try {
    const orderData =
      typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString())
        : req.body;

    console.log("👤 Customer data:", orderData.customer);

    const shopDomain = req.headers["x-shopify-shop-domain"];
    if (!shopDomain) return res.status(400).send("Missing shop domain");

    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!store) return res.status(404).send("Store not found");

    const shopifyOrderId = `gid://shopify/Order/${orderData.id}`;

    // Check if order already exists
    const existingOrder = await prisma.order.findUnique({
      where: {
        shopifyId_storeId: {
          shopifyId: shopifyOrderId,
          storeId: store.id,
        },
      },
    });

    if (existingOrder) {
      console.log("⚠️ Order already exists, skipping");
      return res.status(200).send("OK");
    }

    // Merge duplicate line items
    const mergedLineItems = Object.values(
      orderData.line_items.reduce((acc, item) => {
        const key = `${item.product_id}-${item.variant_id || "null"}`;
        if (!acc[key]) acc[key] = { ...item };
        else acc[key].quantity += item.quantity;
        return acc;
      }, {})
    );

    const order = await prisma.order.create({
      data: {
        shopifyId: shopifyOrderId,
        orderNumber: orderData.order_number,
        storeId: store.id,

        // ✅ Access customer info directly and safely
        customerName: orderData.customer
          ? `${orderData.customer.first_name || ""} ${
              orderData.customer.last_name || ""
            }`.trim()
          : null,
        customerEmail: orderData.customer?.email || null,
        customerPhone:
          orderData.customer?.phone ||
          orderData.customer?.default_address?.phone ||
          orderData.shipping_address?.phone ||
          null,

        // ✅ Address from customer default_address or shipping_address
        address1:
          orderData.customer?.default_address?.address1 ||
          orderData.shipping_address?.address1 ||
          null,
        address2:
          orderData.customer?.default_address?.address2 ||
          orderData.shipping_address?.address2 ||
          null,
        province:
          orderData.customer?.default_address?.province ||
          orderData.shipping_address?.province ||
          null,
        totalPrice: orderData.current_total_price
          ? parseFloat(orderData.current_total_price)
          : null,
        status: "PENDING",

        // ✅ Items creation
        items: {
          create: await Promise.all(
            mergedLineItems.map(async (item) => {
              const shopifyProductId = `gid://shopify/Product/${item.product_id}`;
              const shopifyVariantId = `gid://shopify/ProductVariant/${item.variant_id}`;

              const product = await prisma.product.findUnique({
                where: {
                  shopifyId_storeId: {
                    shopifyId: shopifyProductId,
                    storeId: store.id,
                  },
                },
              });

              if (!product) {
                console.warn(`⚠️ Product not found: ${shopifyProductId}`);
                return null;
              }

              const variant = await prisma.productVariant.findUnique({
                where: {
                  shopifyId_productId: {
                    shopifyId: shopifyVariantId,
                    productId: product.id,
                  },
                },
              });

              return {
                productId: product.id,
                variantId: variant?.id || null,
                quantity: item.quantity,
                price: item.price ? parseFloat(item.price) : null,
                status: "WAITING_BATCH",
              };
            })
          ).then((items) => items.filter(Boolean)),
        },
      },
      include: { items: true },
    });

    // Auto-assign to batch
    try {
      await assignOrderItemsToBatches(order.items);
      console.log("🧺 Items assigned to batches successfully");
    } catch (err) {
      console.error("❌ Error assigning items to batches:", err);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error saving order:", err);
    return res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  handleProductCreate,
  handleProductUpdate,
  handleProductDelete,
  handleOrderCreate,
};
