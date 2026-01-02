const prisma = require("../prisma/client");

const { assignOrderItemsToBatches } = require("../helpers/batchHelper");
const {
  findInventoryItemIdBySku,
  setInventoryQuantityExact,
} = require("../services/shopifyServices");
const { decrypt } = require("../lib/crypto");

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

    const processedItems = [];
    const stockChanges = []; // { mainStockId, sku }[]

    await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          shopifyId: shopifyOrderId,
          orderNumber: orderData.order_number,
          storeId: store.id,
          customerName: orderData.customer
            ? `${orderData.customer.first_name || ""} ${orderData.customer.last_name || ""
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
          shopifyCurrency: orderData.currency || null,
          shopifyTransactions: JSON.stringify(orderData.transactions || []),
          shopifyLocationId: store.shopifyLocationId || null,
          status: "PENDING",
        },
      });

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

        const productRule = await tx.productTypeRule.findFirst({
          where: {
            storeId: store.id,
            name: { equals: product.productType, mode: "insensitive" },
            OR: [
              { variantTitle: item.variant_title || undefined },
              { variantTitle: null },
            ],
          },
        });

        const requiresStock = productRule?.requiresStock === true;

        const orderItemData = {
          orderId: createdOrder.id,
          productId: product.id,
          variantId: variant?.id || null,
          quantity: item.quantity,
          price: item.price ? parseFloat(item.price) : null,
          status: "WAITING_BATCH",
          shopifyLineItemId: `gid://shopify/LineItem/${item.id}`,
        };

        const createdOrderItem = await tx.orderItem.create({
          data: orderItemData,
        });

        const rules = await tx.productTypeRule.findMany({
          where: {
            storeId: createdOrder.storeId,
            name: product.productType,
            variantTitle: variant?.title,
          },
          include: { mainStocks: true },
        });

        for (const rule of rules) {
          for (const mainStock of rule.mainStocks) {
            const sku = variant?.sku || product.sku;

            const stockRecord = await tx.productStockQuantity.findUnique({
              where: {
                mainStockId_sku: {
                  mainStockId: mainStock.id,
                  sku,
                },
              },
            });

            if (!stockRecord) continue;

            const newQty = stockRecord.quantity - item.quantity;

            await tx.productStockQuantity.update({
              where: { id: stockRecord.id },
              data: {
                quantity: newQty,
                updatedAt: new Date(),
              },
            });

            // remember this change for Shopify sync
            stockChanges.push({ mainStockId: mainStock.id, sku });
          }
        }

        if (requiresStock && variant) {
          const variantTitle = item.variant_title || variant.title || null;
          console.log(
            `Processing stock decrement for variantTitle: ${variantTitle}`
          );

          if (!variantTitle) {
            console.warn(
              `⚠️ No variant title for ProductVariant ${variant.id}, cannot map to StockVariant`
            );
          } else {
            const stockVariant = await tx.stockVariant.findFirst({
              where: { variantTitle },
            });

            if (!stockVariant) {
              console.warn(
                `⚠️ No StockVariant found for variantTitle "${variantTitle}"`
              );
            } else {
              const qty = item.quantity;

              if (stockVariant.currentStock < qty) {
                throw new Error(
                  `Insufficient stock for ${stockVariant.name} (have ${stockVariant.currentStock}, need ${qty})`
                );
              }

              await tx.stockVariant.update({
                where: { id: stockVariant.id },
                data: {
                  currentStock: {
                    decrement: qty,
                  },
                },
              });
            }
          }
        }

        processedItems.push(createdOrderItem);
      }
    });

    // AFTER transaction: sync updated main stocks to Shopify (use final CRM values)
    await syncMainStocksToShopify(stockChanges);

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

function dedupeStockChanges(changes) {
  const seen = new Set();
  const result = [];
  for (const c of changes) {
    const key = `${c.mainStockId}:${c.sku}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

async function syncMainStocksToShopify(stockChanges) {
  const uniqueChanges = dedupeStockChanges(stockChanges);

  for (const { mainStockId, sku } of uniqueChanges) {
    try {
      console.log("🔄 Syncing mainStock to Shopify", { mainStockId, sku });

      // 1) Get updated quantity from DB (absolute quantity to push)
      const record = await prisma.productStockQuantity.findUnique({
        where: { mainStockId_sku: { mainStockId, sku } },
      });
      if (!record) {
        console.warn("No productStockQuantity record, skipping", {
          mainStockId,
          sku,
        });
        continue;
      }
      const qty = record.quantity;

      console.log("🔢 CRM final quantity for sync", {
        mainStockId,
        sku,
        qty,
      });

      // 2) Load MainStock with rules + store
      const mainStock = await prisma.mainStock.findUnique({
        where: { id: mainStockId },
        include: {
          rules: {
            include: { store: true },
          },
        },
      });
      if (!mainStock) {
        console.warn("MainStock not found during sync, skipping", {
          mainStockId,
        });
        continue;
      }

      const storeIds = Array.from(
        new Set(mainStock.rules.map((r) => r.storeId).filter((id) => !!id))
      );
      if (storeIds.length === 0) {
        console.log("No rules/stores for mainStock, skipping sync", {
          mainStockId,
        });
        continue;
      }

      // 3) Find variants with this SKU in those stores
      const variants = await prisma.productVariant.findMany({
        where: {
          sku,
          product: {
            storeId: { in: storeIds },
          },
        },
        include: {
          product: {
            include: { store: true },
          },
        },
      });

      console.log("Found variants for sync", {
        mainStockId,
        sku,
        variantsCount: variants.length,
      });

      // 4) For each variant+store, check rule and push to Shopify
      for (const variant of variants) {
        const store = variant.product.store;
        if (!store) continue;

        const rule = mainStock.rules.find((r) => {
          if (r.storeId !== store.id) return false;
          if (r.name !== variant.product.productType) return false;
          if (r.variantTitle && r.variantTitle.trim().length > 0) {
            if (r.variantTitle !== variant.title) return false;
          }
          return true;
        });

        if (!rule) {
          console.log("No matching rule for variant, skipping", {
            mainStockId,
            sku,
            storeId: store.id,
            productType: variant.product.productType,
            variantTitle: variant.title,
          });
          continue;
        }

        const shopDomain = store.shopDomain;
        const accessToken = decrypt(store.accessToken);
        const locationId = store.shopifyLocationId;
        if (!locationId) {
          console.warn(
            "No shopifyLocationId for store; skipping Shopify sync",
            {
              storeId: store.id,
            }
          );
          continue;
        }

        console.log("🚀 Pushing quantity to Shopify", {
          shopDomain,
          storeId: store.id,
          sku,
          qty,
        });

        const inventoryItemId = await findInventoryItemIdBySku(
          shopDomain,
          accessToken,
          sku
        );
        if (!inventoryItemId) {
          console.warn("No inventoryItemId for sku in store, skipping", {
            sku,
            storeId: store.id,
          });
          continue;
        }

        await setInventoryQuantityExact(shopDomain, accessToken, {
          locationId,
          inventoryItemId,
          quantity: qty,
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: true,
        });

        console.log("✅ Synced to Shopify", {
          mainStockId,
          sku,
          storeId: store.id,
          qty,
        });
      }
    } catch (err) {
      console.error("❌ Error syncing mainStock to Shopify", {
        mainStockId,
        sku,
        error: err.message,
      });
    }
  }
}

function dedupeStockChanges(changes) {
  const seen = new Set();
  const result = [];
  for (const c of changes) {
    const key = `${c.mainStockId}:${c.sku}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

async function syncMainStocksToShopify(stockChanges) {
  const uniqueChanges = dedupeStockChanges(stockChanges);

  for (const { mainStockId, sku } of uniqueChanges) {
    try {
      console.log("🔄 Syncing mainStock to Shopify", { mainStockId, sku });

      // 1) Get updated quantity from DB (absolute quantity to push)
      const record = await prisma.productStockQuantity.findUnique({
        where: { mainStockId_sku: { mainStockId, sku } },
      });
      if (!record) {
        console.warn("No productStockQuantity record, skipping", {
          mainStockId,
          sku,
        });
        continue;
      }
      const qty = record.quantity;

      // 2) Load MainStock with rules + store
      const mainStock = await prisma.mainStock.findUnique({
        where: { id: mainStockId },
        include: {
          rules: {
            include: { store: true },
          },
        },
      });
      if (!mainStock) {
        console.warn("MainStock not found during sync, skipping", {
          mainStockId,
        });
        continue;
      }

      const storeIds = Array.from(
        new Set(mainStock.rules.map((r) => r.storeId).filter((id) => !!id))
      );
      if (storeIds.length === 0) {
        console.log("No rules/stores for mainStock, skipping sync", {
          mainStockId,
        });
        continue;
      }

      // 3) Find variants with this SKU in those stores
      const variants = await prisma.productVariant.findMany({
        where: {
          sku,
          product: {
            storeId: { in: storeIds },
          },
        },
        include: {
          product: {
            include: { store: true },
          },
        },
      });

      console.log("Found variants for sync", {
        mainStockId,
        sku,
        variantsCount: variants.length,
      });

      // 4) For each variant+store, check rule and push to Shopify
      for (const variant of variants) {
        const store = variant.product.store;
        if (!store) continue;

        const rule = mainStock.rules.find((r) => {
          if (r.storeId !== store.id) return false;
          if (r.name !== variant.product.productType) return false;
          if (r.variantTitle && r.variantTitle.trim().length > 0) {
            if (r.variantTitle !== variant.title) return false;
          }
          return true;
        });

        if (!rule) {
          console.log("No matching rule for variant, skipping", {
            mainStockId,
            sku,
            storeId: store.id,
            productType: variant.product.productType,
            variantTitle: variant.title,
          });
          continue;
        }

        const shopDomain = store.shopDomain;
        const accessToken = decrypt(store.accessToken);
        const locationId = store.shopifyLocationId;
        if (!locationId) {
          console.warn(
            "No shopifyLocationId for store; skipping Shopify sync",
            {
              storeId: store.id,
            }
          );
          continue;
        }

        console.log("🔍 Shopify sync target", {
          shopDomain,
          locationId,
          sku,
          qty,
        });

        const inventoryItemId = await findInventoryItemIdBySku(
          shopDomain,
          accessToken,
          sku
        );
        if (!inventoryItemId) {
          console.warn("No inventoryItemId for sku in store, skipping", {
            sku,
            storeId: store.id,
          });
          continue;
        }

        await setInventoryQuantityExact(shopDomain, accessToken, {
          locationId,
          inventoryItemId,
          quantity: qty,
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: true,
        });

        console.log("✅ Synced to Shopify", {
          mainStockId,
          sku,
          storeId: store.id,
          qty,
        });
      }
    } catch (err) {
      console.error("❌ Error syncing mainStock to Shopify", {
        mainStockId,
        sku,
        error: err.message,
      });
    }
  }
}

module.exports = {
  handleProductCreate,
  handleProductUpdate,
  handleProductDelete,
  handleOrderCreate,
};
