const prisma = require("../prisma/client");

// Create new product type rule
async function createRule(req, res) {
  try {
    const { name, isPod, storeName } = req.body;

    if (!name) return res.status(400).json({ error: "Missing rule name" });
    if (!storeName)
      return res.status(400).json({ error: "Missing store name" });

    const trimmedName = name.trim();

    // 🏪 Find the store by name (case-insensitive)
    const store = await prisma.store.findFirst({
      where: { name: { equals: storeName.trim(), mode: "insensitive" } },
    });

    if (!store) {
      return res.status(404).json({ error: `Store '${storeName}' not found` });
    }

    // 🔍 Check if a rule with this name already exists for this store
    let rule = await prisma.productTypeRule.findFirst({
      where: {
        name: { equals: trimmedName, mode: "insensitive" },
        storeId: store.id,
      },
    });

    if (rule) {
      // Rule exists → update if needed
      if (rule.isPod !== !!isPod) {
        rule = await prisma.productTypeRule.update({
          where: { id: rule.id },
          data: { isPod: !!isPod },
        });

        // 🧩 Update this store's products matching this rule name
        await prisma.product.updateMany({
          where: {
            storeId: store.id,
            productType: { equals: rule.name, mode: "insensitive" },
          },
          data: { isPod: rule.isPod },
        });
      }

      return res.status(200).json(rule);
    }

    // 🆕 Create new rule for this store
    rule = await prisma.productTypeRule.create({
      data: {
        name: trimmedName,
        isPod: !!isPod,
        storeId: store.id, // ✅ use storeId, not id
      },
    });

    // 🧩 Update products that match this new rule name for this store
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
    });

    // 2️⃣ Delete related batches (and cascade down BatchItems, etc.)
    await prisma.batch.deleteMany({
      where: { id: { in: relatedBatches.map((b) => b.id) } },
    });

    // 3️⃣ Delete the rule itself
    const rule = await prisma.productTypeRule.delete({
      where: { id },
    });

    // 4️⃣ Optionally, update products linked to this rule
    await prisma.product.updateMany({
      where: { productType: rule.name },
      data: { isPod: false },
    });

    res.json({ message: "Rule and related batches deleted", rule });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
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
