const prisma = require("../prisma/client");

// StockItem Controllers

exports.createStockItem = async (req, res) => {
  try {
    const { name, sku } = req.body;
    if (!name || !sku)
      return res.status(400).json({ error: "Name and SKU are required" });

    const exists = await prisma.stockItem.findUnique({ where: { sku } });
    if (exists)
      return res
        .status(409)
        .json({ error: "StockItem with this SKU already exists" });

    const stockItem = await prisma.stockItem.create({
      data: { name, sku },
    });
    res.status(201).json(stockItem);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getStockItems = async (_, res) => {
  try {
    const items = await prisma.stockItem.findMany({
      include: { variants: true },
    });
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getStockItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.stockItem.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!item) return res.status(404).json({ error: "StockItem not found" });
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateStockItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sku } = req.body;
    const updated = await prisma.stockItem.update({
      where: { id },
      data: { name, sku },
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteStockItem = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.stockItem.delete({ where: { id } });
    res.json({ message: "StockItem deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// StockVariant Controllers

exports.createStockVariant = async (req, res) => {
  try {
    const {
      stockItemId,
      sku,
      name,
      color,
      size,
      currentStock,
      minStockLevel,
      maxStockLevel,
      // new fields (can be single string or array, see normalization below)
      storeIds,
      productTypes,
      variantTitles,
    } = req.body;

    if (!stockItemId || !sku || !name) {
      return res
        .status(400)
        .json({ error: "stockItemId, SKU, and name are required" });
    }

    const variantExists = await prisma.stockVariant.findUnique({
      where: { sku },
    });
    if (variantExists) {
      return res
        .status(409)
        .json({ error: "StockVariant with this SKU exists" });
    }

    // Normalize to arrays so you can accept both single string and array from the client
    const normStoreIds =
      storeIds == null ? [] : Array.isArray(storeIds) ? storeIds : [storeIds];

    const normProductTypes =
      productTypes == null
        ? []
        : Array.isArray(productTypes)
        ? productTypes
        : [productTypes];

    const normVariantTitles =
      variantTitles == null
        ? []
        : Array.isArray(variantTitles)
        ? variantTitles
        : [variantTitles];

    const variant = await prisma.stockVariant.create({
      data: {
        stockItemId,
        sku,
        name,
        color,
        size,
        currentStock: currentStock ?? 0,
        minStockLevel: minStockLevel ?? 5,
        maxStockLevel: maxStockLevel ?? null,
        storeIds: normStoreIds,
        productTypes: normProductTypes,
        variantTitles: normVariantTitles,
      },
    });

    res.status(201).json(variant);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getStockVariants = async (_, res) => {
  try {
    const variants = await prisma.stockVariant.findMany({
      include: { stockItem: true },
    });
    res.json(variants);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getStockVariants = async (_, res) => {
  try {
    const variants = await prisma.stockVariant.findMany({
      include: { stockItem: true },
    });
    res.json(variants);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getStockVariantById = async (req, res) => {
  try {
    const { id } = req.params;
    const variant = await prisma.stockVariant.findUnique({
      where: { id },
      include: { stockItem: true },
    });
    if (!variant)
      return res.status(404).json({ error: "StockVariant not found" });
    res.json(variant);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateStockVariant = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      stockItemId,
      sku,
      name,
      color,
      size,
      currentStock,
      minStockLevel,
      maxStockLevel,
      storeIds,
      productTypes,
      variantTitles,
    } = req.body;

    const data = {};

    if (stockItemId !== undefined) data.stockItemId = stockItemId;
    if (sku !== undefined) data.sku = sku;
    if (name !== undefined) data.name = name;
    if (color !== undefined) data.color = color;
    if (size !== undefined) data.size = size;
    if (currentStock !== undefined) data.currentStock = currentStock;
    if (minStockLevel !== undefined) data.minStockLevel = minStockLevel;
    if (maxStockLevel !== undefined) data.maxStockLevel = maxStockLevel;

    if (storeIds !== undefined) {
      data.storeIds = Array.isArray(storeIds) ? storeIds : [storeIds];
    }
    if (productTypes !== undefined) {
      data.productTypes = Array.isArray(productTypes)
        ? productTypes
        : [productTypes];
    }
    if (variantTitles !== undefined) {
      data.variantTitles = Array.isArray(variantTitles)
        ? variantTitles
        : [variantTitles];
    }

    const updated = await prisma.stockVariant.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteStockVariant = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.stockVariant.delete({ where: { id } });
    res.json({ message: "StockVariant deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
