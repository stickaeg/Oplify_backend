async function adjustMainStock(
  tx,
  productType,
  variantTitle,
  storeId,
  quantity,
  action
) {
  // Find rule → MainStocks → Adjust quantity

  console.log(`🔍 adjustMainStock called: ${productType}, ${action}`); // 👈 ADD

  const productRule = await tx.productTypeRule.findFirst({
    where: {
      storeId,
      name: productType,
      variantTitle: variantTitle || null,
    },
    include: {
      mainStocks: true,
    },
  });

  if (!productRule?.mainStocks?.length) {
    console.log(`ℹ️ No main stocks for ${productType}`);
    return;
  }

  // Adjust ALL connected main stocks
  for (const mainStock of productRule.mainStocks) {
    if (action === "decrement") {
      await tx.mainStock.update({
        where: { id: mainStock.id },
        data: { quantity: { decrement: quantity } },
      });
    } else if (action === "increment") {
      await tx.mainStock.update({
        where: { id: mainStock.id },
        data: { quantity: { increment: quantity } },
      });
    }

    console.log(
      `📦 ${action.toUpperCase()} ${quantity} from "${mainStock.name}"`
    );
  }
}

module.exports = { adjustMainStock };
