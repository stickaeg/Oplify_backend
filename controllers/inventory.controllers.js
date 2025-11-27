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
    } = req.body;

    console.log(req.body);

    if (!stockItemId || !sku || !name)
      return res
        .status(400)
        .json({ error: "stockItemId, SKU, and name are required" });

    const variantExists = await prisma.stockVariant.findUnique({
      where: { sku },
    });
    if (variantExists)
      return res
        .status(409)
        .json({ error: "StockVariant with this SKU exists" });

    const variant = await prisma.stockVariant.create({
      data: {
        stockItemId,
        sku,
        name,
        color,
        size,
        currentStock: currentStock || 0,
        minStockLevel: minStockLevel || 5,
        maxStockLevel,
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
    const data = req.body;
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

// ProductStockMapping Controllers

exports.createProductStockMapping = async (req, res) => {
  try {
    const { productVariantId, stockVariantId, quantityRequired } = req.body;
    if (!productVariantId || !stockVariantId)
      return res
        .status(400)
        .json({ error: "productVariantId and stockVariantId required" });

    const mappingExists = await prisma.productStockMapping.findFirst({
      where: { productVariantId, stockVariantId },
    });
    if (mappingExists)
      return res.status(409).json({
        error: "Mapping already exists for this product and stock variant",
      });

    const mapping = await prisma.productStockMapping.create({
      data: {
        productVariantId,
        stockVariantId,
        quantityRequired: quantityRequired || 1,
      },
    });
    res.status(201).json(mapping);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getProductStockMappings = async (_, res) => {
  try {
    const mappings = await prisma.productStockMapping.findMany({
      include: { productVariant: true, stockVariant: true },
    });
    res.json(mappings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteProductStockMapping = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.productStockMapping.delete({ where: { id } });
    res.json({ message: "Mapping deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
