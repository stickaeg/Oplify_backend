const prisma = require("../prisma/client");

// ===================== CREATE MAIN STOCK =====================
async function createMainStock(req, res) {
  try {
    const { name, ruleIds = [] } = req.body;

    if (!name)
      return res.status(400).json({ error: "Missing main stock name" });

    // Validate ruleIds are pure stock rules
    if (ruleIds.length > 0) {
      const rules = await prisma.productTypeRule.findMany({
        where: {
          id: { in: ruleIds },
          isPod: false,
          requiresStock: false,
        },
      });

      if (rules.length !== ruleIds.length) {
        return res.status(400).json({
          error:
            "All rules must be pure stock rules (isPod=false & requiresStock=false)",
        });
      }
    }

    // Create MainStock
    const mainStock = await prisma.mainStock.create({
      data: {
        name: name.trim(),
        rules: { connect: ruleIds.map((id) => ({ id })) },
      },
      include: { rules: true },
    });

    return res.status(201).json(mainStock);
  } catch (err) {
    console.error("Error creating main stock:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

// ===================== LIST ALL MAIN STOCK =====================
async function listMainStock(req, res) {
  try {
    const userStoreId = req.storeId;

    const mainStocks = await prisma.mainStock.findMany({
      where: userStoreId
        ? {
            rules: { some: { storeId: userStoreId } },
          }
        : {},
      include: {
        rules: userStoreId
          ? {
              where: { storeId: userStoreId },
              include: {
                // 👈 ADD THIS
                store: {
                  select: { id: true, name: true },
                },
              },
            }
          : {
              include: {
                store: {
                  select: { id: true, name: true },
                },
              },
            },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(mainStocks);
  } catch (err) {
    console.error("Error listing main stock:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

// ===================== GET MAIN STOCK BY ID =====================
async function getMainStockById(req, res) {
  try {
    const { id } = req.params;
    const mainStock = await prisma.mainStock.findUnique({
      where: { id },
      include: { rules: true },
    });
    if (!mainStock)
      return res.status(404).json({ error: "Main stock not found" });
    return res.json(mainStock);
  } catch (err) {
    console.error("Error fetching main stock:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

// ===================== UPDATE MAIN STOCK =====================
async function updateMainStock(req, res) {
  try {
    const { id } = req.params;
    const { name, quantity, addRuleIds = [], removeRuleIds = [] } = req.body;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (typeof quantity === "number") updateData.quantity = quantity;

    // Update MainStock basic data
    let mainStock = await prisma.mainStock.update({
      where: { id },
      data: updateData,
      include: { rules: true },
    });

    // Connect new rules
    if (addRuleIds.length > 0) {
      const rules = await prisma.productTypeRule.findMany({
        where: {
          id: { in: addRuleIds },
          isPod: false,
          requiresStock: false,
        },
      });
      if (rules.length !== addRuleIds.length)
        return res.status(400).json({
          error:
            "All added rules must be pure stock rules (isPod=false & requiresStock=false)",
        });

      await prisma.mainStock.update({
        where: { id },
        data: { rules: { connect: addRuleIds.map((id) => ({ id })) } },
      });
    }

    // Disconnect rules
    if (removeRuleIds.length > 0) {
      await prisma.mainStock.update({
        where: { id },
        data: { rules: { disconnect: removeRuleIds.map((id) => ({ id })) } },
      });
    }

    // Return updated main stock
    mainStock = await prisma.mainStock.findUnique({
      where: { id },
      include: { rules: true },
    });

    return res.json(mainStock);
  } catch (err) {
    console.error("Error updating main stock:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

// ===================== DELETE MAIN STOCK =====================
async function deleteMainStock(req, res) {
  try {
    const { id } = req.params;

    // Disconnect rules first
    await prisma.productTypeRule.updateMany({
      where: { mainStockId: id },
      data: { mainStockId: null },
    });

    // Delete MainStock
    const mainStock = await prisma.mainStock.delete({
      where: { id },
    });

    return res.json({ message: "Main stock deleted successfully", mainStock });
  } catch (err) {
    console.error("Error deleting main stock:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

// ===================== ASSIGN PRODUCT QUANTITY (SKU BASED) =====================
async function assignProductQuantity(req, res) {
  const { mainStockId } = req.params;
  const { sku, quantity } = req.body;

  try {
    await prisma.productStockQuantity.upsert({
      where: { mainStockId_sku: { mainStockId, sku } },
      create: { mainStockId, sku, quantity },
      update: { quantity },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function listProductQuantities(req, res) {
  try {
    const { mainStockId } = req.params;

    const quantities = await prisma.productStockQuantity.findMany({
      where: { mainStockId },
      include: {
        productVariant: {
          select: {
            id: true,
            sku: true, // <--- Include SKU
            title: true,
            price: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(quantities);
  } catch (err) {
    console.error("Error listing product quantities:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ===================== DELETE PRODUCT QUANTITY (SKU BASED) =====================
async function deleteProductQuantity(req, res) {
  try {
    const { mainStockId, sku } = req.params;

    // Find variant by SKU
    const variant = await prisma.productVariant.findUnique({
      where: { sku },
    });

    if (!variant)
      return res.status(404).json({ error: `SKU not found: ${sku}` });

    await prisma.productStockQuantity.delete({
      where: {
        productVariantId_mainStockId: {
          productVariantId: variant.id,
          mainStockId,
        },
      },
    });

    return res.json({ message: "Quantity removed for SKU" });
  } catch (err) {
    console.error("Error deleting product quantity:", err);
    return res.status(500).json({ error: err.message });
  }
}

// GET all products for a main stock (merged by SKU with quantities)
async function getProductsByMainStock(req, res) {
  try {
    const { mainStockId } = req.params;

    // Get rules for this main stock
    const mainStock = await prisma.mainStock.findUnique({
      where: { id: mainStockId },
      include: { rules: true },
    });

    if (!mainStock)
      return res.status(404).json({ error: "Main stock not found" });

    const ruleNames = mainStock.rules.map((r) => r.name);

    // Get all products whose productType matches the main stock rules
    const products = await prisma.product.findMany({
      where: { productType: { in: ruleNames } },
      include: {
        variants: true, // get all product variants
        store: true, // include store info if needed
      },
    });

    // Fetch existing stock quantities
    const quantities = await prisma.productStockQuantity.findMany({
      where: { mainStockId },
    });

    // Flatten all variants, attach quantity, and filter out those without SKU
    const flattened = products.flatMap((p) =>
      p.variants
        .filter((v) => v.sku)
        .map((v) => {
          const qty = quantities.find((q) => q.productVariantId === v.id);
          return {
            sku: v.sku,
            productName: p.title,
            variantTitle: v.title,
            storeId: p.storeId,
            storeName: p.store?.name || "Unknown",
            quantity: qty ? qty.quantity : 0,
          };
        })
    );

    // Merge variants by SKU and sum quantities
    const merged = Object.values(
      flattened.reduce((acc, item) => {
        if (!acc[item.sku]) {
          acc[item.sku] = { ...item };
        } else {
          acc[item.sku].quantity += item.quantity;
        }
        return acc;
      }, {})
    );

    return res.json(merged);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

module.exports = {
  // ...other controllers
  getProductsByMainStock,
};

module.exports = {
  createMainStock,
  listMainStock,
  getMainStockById,
  updateMainStock,
  deleteMainStock,

  assignProductQuantity, // create/update
  listProductQuantities, // list for admin
  deleteProductQuantity,
  getProductsByMainStock,
};
