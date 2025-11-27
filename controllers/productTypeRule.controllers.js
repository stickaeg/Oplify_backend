const prisma = require("../prisma/client");

async function createRule(req, res) {
  try {
    const { name, isPod, requiresStock, storeName } = req.body;

    if (!name) return res.status(400).json({ error: "Missing rule name" });
    if (!storeName)
      return res.status(400).json({ error: "Missing store name" });

    const trimmedName = name.trim();

    const store = await prisma.store.findFirst({
      where: { name: { equals: storeName.trim(), mode: "insensitive" } },
    });

    if (!store) {
      return res.status(404).json({ error: `Store '${storeName}' not found` });
    }

    let rule = await prisma.productTypeRule.findFirst({
      where: {
        name: { equals: trimmedName, mode: "insensitive" },
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

        // Update related products if needed
        await prisma.product.updateMany({
          where: {
            storeId: store.id,
            productType: { equals: rule.name, mode: "insensitive" },
          },
          data: {
            isPod: rule.isPod,
            // optionally handle stock flags on products if relevant
          },
        });
      }

      return res.status(200).json(rule);
    }

    rule = await prisma.productTypeRule.create({
      data: {
        name: trimmedName,
        isPod: !!isPod,
        requiresStock: !!requiresStock,
        storeId: store.id,
      },
    });

    await prisma.product.updateMany({
      where: {
        storeId: store.id,
        productType: { equals: rule.name, mode: "insensitive" },
      },
      data: { isPod: rule.isPod },
    });

    return res.status(201).json({
      ...rule,
      storeName: store.name,
    });
  } catch (err) {
    console.error("Error creating rule:", err);
    return res.status(500).json({ error: "Server error" });
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

// List rules
async function listRules(req, res) {
  try {
    const rules = await prisma.productTypeRule.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        store: {
          select: {
            id: true,
            name: true, // 👈 get the store name
          },
        },
      },
    });

    return res.json(rules);
  } catch (err) {
    console.error(err);
    return res.status(500).send("server error");
  }
}
// Optional: Delete rule
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

module.exports = {
  createRule,
  updateRule,
  listRules,
  deleteRule,

  listProductTypesByStore,
};
