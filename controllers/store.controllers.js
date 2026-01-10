const { encrypt } = require("../lib/crypto");
const {
  fetchAllProductsGraphql,
  createWebhook,
  deleteOldWebhooks,
  createOrderWebhook,
  fetchShopLocationId,
  createInventoryWebhook,
} = require("../services/shopifyServices");
const prisma = require("../prisma/client");

async function addStore(req, res) {
  try {
    const { shopDomain, name, accessToken, apiSecret, bostaApiKey } = req.body;
    if (!shopDomain || !accessToken) {
      return res.status(400).send("missing shopDomain or accessToken");
    }

    const tokenEnc = encrypt(accessToken);
    const secretEnc = apiSecret ? encrypt(apiSecret) : null;
    const bostaKeyEnc = bostaApiKey ? encrypt(bostaApiKey) : null;

    // Upsert store (create if new, update if existing)
    const store = await prisma.store.upsert({
      where: { shopDomain },
      create: {
        shopDomain,
        name,
        accessToken: tokenEnc,
        apiSecret: secretEnc,
        bostaApiKey: bostaKeyEnc,
      },
      update: {
        name,
        accessToken: tokenEnc,
        apiSecret: secretEnc,
        bostaApiKey: bostaKeyEnc,
      },
    });

    await deleteOldWebhooks(shopDomain, accessToken);

    await createOrderWebhook(
      shopDomain,
      accessToken,
      `${process.env.HOST}/webhooks/orders/create`
    );

    try {
      await createInventoryWebhook(
        shopDomain,
        accessToken,
        `${process.env.HOST}/webhooks/inventory/update`
      );
      console.log(
        `✅ Inventory webhook (inventory_levels/update) created for ${shopDomain}`
      );
    } catch (err) {
      console.error(
        "❌ Error creating inventory webhook:",
        err?.message || err
      );
    }

    // Create Shopify webhook (example: PRODUCTS_UPDATE)
    try {
      const topics = [
        { topic: "PRODUCTS_CREATE", path: "/webhooks/products/create" },
        { topic: "PRODUCTS_UPDATE", path: "/webhooks/products/update" },
        { topic: "PRODUCTS_DELETE", path: "/webhooks/products/delete" },
      ];

      for (const t of topics) {
        const webhook = await createWebhook(
          shopDomain,
          accessToken,
          t.topic,
          `${process.env.HOST}${t.path}`
        );

        if (!webhook) {
          console.warn(
            `❌ Webhook creation failed for store: ${shopDomain}, topic: ${t.topic}`
          );
        } else {
          console.log(`✅ Webhook created: ${webhook.id}, topic: ${t.topic}`);
        }
      }
    } catch (err) {
      console.error("Webhook creation error:", err?.message || err);
    }

    try {
      const locationId = await fetchShopLocationId(shopDomain, accessToken);
      await prisma.store.update({
        where: { id: store.id },
        data: { shopifyLocationId: locationId },
      });
      console.log(`✅ Store location saved: ${locationId}`);
    } catch (err) {
      console.warn("Failed to fetch/save store location:", err.message);
    }

    // Sync products
    try {
      await fetchAllProductsGraphql(shopDomain, accessToken, async (page) => {
        for (const p of page) {
          // Normalize productType
          const productType = p.productType?.trim() || null;

          // Check if there's a matching rule (case-insensitive)
          let isPod = false;
          if (productType) {
            const matchingRule = await prisma.productTypeRule.findFirst({
              where: {
                name: { equals: productType, mode: "insensitive" },
              },
            });
            isPod = matchingRule?.isPod || false;
          }

          // Upsert the product
          const product = await prisma.product.upsert({
            where: {
              shopifyId_storeId: {
                shopifyId: String(p.id),
                storeId: store.id,
              },
            },
            create: {
              shopifyId: String(p.id),
              storeId: store.id,
              title: p.title || "",
              productType: productType,
              imgUrl: p.media?.nodes?.[0]?.image?.url || null,
              isPod: isPod,
            },
            update: {
              title: p.title || "",
              productType: productType,
              imgUrl: p.media?.nodes?.[0]?.image?.url || null,
              isPod: isPod,
            },
          });

          // Sync variants
          if (p.variants?.edges && p.variants.edges.length > 0) {
            for (const variantEdge of p.variants.edges) {
              const variant = variantEdge.node;

              await prisma.productVariant.upsert({
                where: {
                  shopifyId_productId: {
                    shopifyId: String(variant.id),
                    productId: product.id,
                  },
                },
                create: {
                  shopifyId: String(variant.id),
                  productId: product.id,
                  sku: variant.sku || null,
                  title: variant.title || null,
                  price: variant.price ? parseFloat(variant.price) : null,
                },
                update: {
                  sku: variant.sku || null,
                  title: variant.title || null,
                  price: variant.price ? parseFloat(variant.price) : null,
                },
              });
            }
          }
        }
      });
    } catch (error) {
      console.error("Error syncing products:", error);
      throw error;
    }

    return res.status(201).json({
      id: store.id,
      shopDomain: store.shopDomain,
      apiSecret: store.apiSecret,
      bostaApiKey: store.bostaApiKey,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send("server error");
  }
}

async function listStores(req, res) {
  try {
    const stores = await prisma.store.findMany({
      select: {
        id: true,
        name: true,
        shopDomain: true,
        createdAt: true,
        bostaApiKey: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(stores);
  } catch (err) {
    console.error(err);
    return res.status(500).send("server error");
  }
}

module.exports = { addStore, listStores };
