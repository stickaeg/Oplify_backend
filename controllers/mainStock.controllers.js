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
  try {
    const { mainStockId } = req.params;
    const { sku, quantity } = req.body;

    if (!sku) return res.status(400).json({ error: "SKU is required" });

    await prisma.productStockQuantity.upsert({
      where: { mainStockId_sku: { mainStockId, sku } },
      create: { mainStockId, sku, quantity },
      update: { quantity },
    });

    return res.json({ success: true, sku, quantity });
  } catch (err) {
    console.error("assignProductQuantity error:", err);
    return res.status(500).json({ error: err.message });
  }
}

async function listProductQuantities(req, res) {
  try {
    const { mainStockId } = req.params;

    const quantities = await prisma.productStockQuantity.findMany({
      where: { mainStockId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(quantities);
  } catch (err) {
    console.error("listProductQuantities error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ===================== DELETE PRODUCT QUANTITY (SKU BASED) =====================
async function deleteProductQuantity(req, res) {
  try {
    const { mainStockId, sku } = req.params;

    await prisma.productStockQuantity.delete({
      where: { mainStockId_sku: { mainStockId, sku } },
    });

    return res.json({ message: `Quantity for SKU ${sku} removed.` });
  } catch (err) {
    console.error("deleteProductQuantity error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// GET all products for a main stock (merged by SKU with quantities)
async function getProductsByMainStock(req, res) {
  try {
    const { mainStockId } = req.params;
    const { sku, title, page = 1, limit = 10 } = req.query; // Get search and pagination parameters

    // Parse and validate pagination parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1 || limitNum < 1) {
      return res.status(400).json({ error: "Page and limit must be positive integers" });
    }

    // 1. Get main stock + rules
    const mainStock = await prisma.mainStock.findUnique({
      where: { id: mainStockId },
      include: { rules: true },
    });

    if (!mainStock)
      return res.status(404).json({ error: "Main stock not found" });

    const ruleNames = mainStock.rules.map((r) => r.name);

    // 2. Get all products across all stores matching main stock rules
    const products = await prisma.product.findMany({
      where: { productType: { in: ruleNames } },
      include: {
        store: true,
        variants: true,
      },
    });

    // 3. Get assigned quantities (SKU-based)
    const quantityRows = await prisma.productStockQuantity.findMany({
      where: { mainStockId },
    });

    const quantityMap = Object.fromEntries(
      quantityRows.map((q) => [q.sku, q.quantity])
    );

    // 4. Flatten all variants → enrich with store quantities + img
    const flattened = products.flatMap((p) =>
      p.variants
        .filter((v) => v.sku)
        .map((v) => ({
          sku: v.sku,
          productName: p.title,
          productImgUrl: p.imgUrl, // <── carry product image here
          variantTitle: v.title,
          storeId: p.storeId,
          storeName: p.store?.name || "Unknown",
          quantity: quantityMap[v.sku] || 0,
        }))
    );

    // 4.5. Filter by search parameters (SKU and/or title)
    let filtered = flattened;

    if (sku) {
      filtered = filtered.filter((item) =>
        item.sku.toLowerCase().includes(sku.toLowerCase())
      );
    }

    if (title) {
      filtered = filtered.filter((item) =>
        item.productName.toLowerCase().includes(title.toLowerCase())
      );
    }

    // 5. Merge quantities by SKU
    const merged = Object.values(
      filtered.reduce((acc, item) => {
        if (!acc[item.sku]) {
          acc[item.sku] = {
            sku: item.sku,
            productName: item.productName,
            productImgUrl: item.productImgUrl, // <── keep it on the merged object
            totalQuantity: quantityMap[item.sku] || 0,
            stores: [],
          };
        }

        acc[item.sku].stores.push({
          storeId: item.storeId,
          storeName: item.storeName,
          quantity: 0,
        });

        return acc;
      }, {})
    );

    // 6. Apply pagination
    const totalItems = merged.length;
    const totalPages = Math.ceil(totalItems / limitNum);
    const skip = (pageNum - 1) * limitNum;
    const paginatedData = merged.slice(skip, skip + limitNum);

    // 7. Return paginated response with metadata
    return res.json({
      data: paginatedData,
      pagination: {
        currentPage: pageNum,
        pageSize: limitNum,
        totalItems: totalItems,
        totalPages: totalPages,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1,
      },
    });
  } catch (err) {
    console.error("getProductsByMainStock error:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getProductsByMainStock,
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
