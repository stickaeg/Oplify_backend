const prisma = require("../prisma/client");

async function createRule(req, res) {
  try {
    const { name, variantTitle, isPod, requiresStock, storeName } = req.body;

    if (!name) return res.status(400).json({ error: "Missing rule name" });
    if (!storeName)
      return res.status(400).json({ error: "Missing store name" });

    const trimmedName = name.trim();
    const trimmedVariantTitle = variantTitle?.trim();

    const store = await prisma.store.findFirst({
      where: { name: { equals: storeName.trim(), mode: "insensitive" } },
    });

    if (!store) {
      return res.status(404).json({ error: `Store '${storeName}' not found` });
    }

    // 🔍 1️⃣ Find existing rule (now checks variantTitle too)
    let rule = await prisma.productTypeRule.findFirst({
      where: {
        name: { equals: trimmedName, mode: "insensitive" },
        variantTitle: trimmedVariantTitle || null, // 👈 Key change!
        storeId: store.id,
      },
    });

    if (rule) {
      const dataToUpdate = {};
      if (rule.isPod !== !!isPod) dataToUpdate.isPod = !!isPod;
      if (rule.requiresStock !== !!requiresStock)
        dataToUpdate.requiresStock = !!requiresStock;

      if (Object.keys(dataToUpdate).length > 0) {
        rule = await prisma.productTypeRule.update({
          where: { id: rule.id },
          data: dataToUpdate,
        });

        // Update related products
        await prisma.product.updateMany({
          where: {
            storeId: store.id,
            productType: { equals: rule.name, mode: "insensitive" },
          },
          data: { isPod: rule.isPod },
        });
      }

      return res.status(200).json({
        ...rule,
        storeName: store.name,
        message: "Rule updated successfully",
      });
    }

    // 🆕 2️⃣ Create NEW rule with variantTitle
    rule = await prisma.productTypeRule.create({
      data: {
        name: trimmedName,
        variantTitle: trimmedVariantTitle || null, // 👈 Store variant!
        isPod: !!isPod,
        requiresStock: !!requiresStock || false,
        storeId: store.id,
      },
    });

    // 🔄 3️⃣ Update related products
    await prisma.product.updateMany({
      where: {
        storeId: store.id,
        productType: { equals: rule.name, mode: "insensitive" },
      },
      data: { isPod: rule.isPod },
    });

    return res.status(201).json({
      rule,
      storeName: store.name,
      message: `Rule "${rule.name}"${
        rule.variantTitle ? ` - ${rule.variantTitle}` : ""
      } created + batch ready!`,
    });
  } catch (err) {
    console.error("Error creating rule:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}
// Update existing rule
async function updateRule(req, res) {
  try {
    const { id } = req.params;
    const { name, isPod } = req.body;

    const rule = await prisma.productTypeRule.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(typeof isPod === "boolean" && { isPod }),
      },
    });

    // Re-classify products if rule changed
    await prisma.product.updateMany({
      where: { productType: rule.name },
      data: { isPod: rule.isPod },
    });

    return res.json(rule);
  } catch (err) {
    console.error(err);
    return res.status(500).send("server error");
  }
}

async function listRules(req, res) {
  try {
    const { isPod, requiresStock, storeId } = req.query;

    // Build dynamic filter object
    const where = {};
    if (typeof isPod !== "undefined") where.isPod = isPod === "true";
    if (typeof requiresStock !== "undefined")
      where.requiresStock = requiresStock === "true";
    if (storeId) where.storeId = storeId;

    const rules = await prisma.productTypeRule.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        store: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.json(rules);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
}

async function deleteRule(req, res) {
  try {
    const { id } = req.params;

    // 1️⃣ Find related batches
    const relatedBatches = await prisma.batch.findMany({
      where: { rules: { some: { id } } },
      select: { id: true },
    });

    const batchIds = relatedBatches.map((b) => b.id);

    if (batchIds.length > 0) {
      // 2️⃣ Find all BatchItems in these batches
      const batchItems = await prisma.batchItem.findMany({
        where: { batchId: { in: batchIds } },
        select: { id: true },
      });

      const batchItemIds = batchItems.map((bi) => bi.id);

      // 3️⃣ Delete BatchItemUnits first (deepest level)
      if (batchItemIds.length > 0) {
        await prisma.batchItemUnit.deleteMany({
          where: { batchItemId: { in: batchItemIds } },
        });
      }

      // 4️⃣ Delete BatchItems
      await prisma.batchItem.deleteMany({
        where: { batchId: { in: batchIds } },
      });

      // 5️⃣ Delete Files linked to batches
      await prisma.file.deleteMany({
        where: { batchId: { in: batchIds } },
      });

      // 6️⃣ Delete Batches
      await prisma.batch.deleteMany({
        where: { id: { in: batchIds } },
      });
    }

    // 7️⃣ Delete the rule itself
    const rule = await prisma.productTypeRule.delete({
      where: { id },
    });

    // 8️⃣ Optionally, update products linked to this rule
    await prisma.product.updateMany({
      where: { productType: rule.name },
      data: { isPod: false },
    });

    res.json({
      message: "Rule and related data deleted successfully",
      rule,
      deletedBatches: batchIds.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
}

async function listProductTypesByStore(req, res) {
  try {
    const { storeName } = req.params;
    if (!storeName)
      return res.status(400).json({ error: "Missing store name" });

    // 1️⃣ Find store by name (case-insensitive)
    const store = await prisma.store.findFirst({
      where: { name: { equals: storeName.trim(), mode: "insensitive" } },
    });

    if (!store)
      return res.status(404).json({ error: `Store '${storeName}' not found` });

    // 2️⃣ Fetch unique product types from that store’s products
    const productTypes = await prisma.product.findMany({
      where: { storeId: store.id },
      distinct: ["productType"],
      select: { productType: true },
    });

    // 3️⃣ Return clean list of names
    const types = productTypes
      .map((p) => p.productType)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return res.json(types);
  } catch (err) {
    console.error("Error listing product types by store:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function listVariantTitlesByProductType(req, res) {
  try {
    const { storeName, productType } = req.params;

    if (!storeName)
      return res.status(400).json({ error: "Missing store name" });
    if (!productType)
      return res.status(400).json({ error: "Missing product type" });

    // 1️⃣ Find store by name (case-insensitive)
    const store = await prisma.store.findFirst({
      where: { name: { equals: storeName.trim(), mode: "insensitive" } },
    });

    if (!store)
      return res.status(404).json({ error: `Store '${storeName}' not found` });

    // 2️⃣ Get DISTINCT variant titles for this product type
    const variants = await prisma.productVariant.findMany({
      where: {
        product: {
          storeId: store.id,
          productType: { equals: productType.trim(), mode: "insensitive" },
        },
        title: { not: null }, // Only variants with titles
      },
      select: { title: true },
      distinct: ["title"], // 🔑 This eliminates redundancy
      orderBy: { title: "asc" },
    });

    // 3️⃣ Clean response
    const titles = variants.map((v) => v.title).filter(Boolean);

    return res.json({
      storeName: store.name,
      productType,
      variantTitles: titles,
      totalUnique: titles.length,
    });
  } catch (err) {
    console.error("Error listing variant titles:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = {
  createRule,
  updateRule,
  listRules,
  deleteRule,
  listVariantTitlesByProductType,
  listProductTypesByStore,
};
