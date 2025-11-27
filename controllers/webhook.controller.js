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

    console.log("Order Info:", orderData);
    console.log("Customer Info:", orderData.customer);

    // Prepare array to hold processed order items for nested create
    const processedItems = [];

    // Start a transaction to create order + items + stock reservations atomically
    await prisma.$transaction(async (tx) => {
      // Create the order first without items
      const createdOrder = await tx.order.create({
        data: {
          shopifyId: shopifyOrderId,
          orderNumber: orderData.order_number,
          storeId: store.id,
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

          // ✅ NEW FIELDS FOR REFUNDS:
          shopifyCurrency: orderData.currency || null,
          shopifyTransactions: JSON.stringify(orderData.transactions || []),
          shopifyLocationId: store.shopifyLocationId || null,

          status: "PENDING",
        },
      });

      // Process each line item for product, variant, and conditionally stock reservation
      for (const item of mergedLineItems) {
        const shopifyProductId = `gid://shopify/Product/${item.product_id}`;
        const shopifyVariantId = `gid://shopify/ProductVariant/${item.variant_id}`;

        const product = await tx.product.findUnique({
          where: {
            shopifyId_storeId: {
              shopifyId: shopifyProductId,
              storeId: store.id,
            },
          },
        });

        if (!product) {
          console.warn(`⚠️ Product not found: ${shopifyProductId}`);
          continue;
        }

        const variant = await tx.productVariant.findUnique({
          where: {
            shopifyId_productId: {
              shopifyId: shopifyVariantId,
              productId: product.id,
            },
          },
        });

        // Load product type rule to check stock requirement
        const productRule = await tx.productTypeRule.findFirst({
          where: {
            storeId: store.id,
            name: product.productType,
          },
        });

        // Default flags for safety
        const requiresStock = productRule?.requiresStock || false;

        // Prepare order item create data; will add stockReservationId if applicable
        const orderItemData = {
          orderId: createdOrder.id,
          productId: product.id,
          variantId: variant?.id || null,
          quantity: item.quantity,
          price: item.price ? parseFloat(item.price) : null,
          status: "WAITING_BATCH",

          // ✅ NEW FIELD FOR REFUNDS:
          shopifyLineItemId: `gid://shopify/LineItem/${item.id}`,
        };

        // Create the order item first to get its ID for reservation
        const createdOrderItem = await tx.orderItem.create({
          data: orderItemData,
        });

        if (requiresStock && variant) {
          // Find StockVariant via ProductStockMapping
          const stockMapping = await tx.productStockMapping.findFirst({
            where: { productVariantId: variant.id },
          });

          if (!stockMapping) {
            console.warn(
              `⚠️ No stock mapping for ProductVariant ${variant.id}`
            );
            // Optionally, you may reject or continue depending on business logic
          } else {
            const stockVariant = await tx.stockVariant.findUnique({
              where: { id: stockMapping.stockVariantId },
            });

            if (!stockVariant || stockVariant.currentStock < item.quantity) {
              throw new Error(
                `Insufficient stock for ${
                  stockVariant?.name || "unknown variant"
                }`
              );
            }

            // Create StockReservation
            await tx.stockReservation.create({
              data: {
                stockVariantId: stockVariant.id,
                orderItemId: createdOrderItem.id,
                quantity: item.quantity,
                status: "RESERVED",
                reservedAt: new Date(),
              },
            });

            // Update StockVariant decrementing currentStock
            await tx.stockVariant.update({
              where: { id: stockVariant.id },
              data: {
                currentStock: stockVariant.currentStock - item.quantity,
              },
            });

            // Record stock movement
            await tx.stockMovement.create({
              data: {
                stockVariantId: stockVariant.id,
                type: "SALE",
                quantity: item.quantity,
                previousStock: stockVariant.currentStock,
                newStock: stockVariant.currentStock - item.quantity,
                orderItemId: createdOrderItem.id,
                reason: "Order Reservation",
              },
            });
          }
        }

        processedItems.push(createdOrderItem);
      }
    });

    // Auto-assign to batch with your existing function
    try {
      await assignOrderItemsToBatches(processedItems);
      console.log("🧺 Items assigned to batches successfully");
    } catch (err) {
      console.error("❌ Error assigning items to batches:", err);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error saving order:", err);
    if (err.message && err.message.includes("Insufficient stock")) {
      return res.status(409).json({ error: err.message });
    }
    return res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  handleProductCreate,
  handleProductUpdate,
  handleProductDelete,
  handleOrderCreate,
};
