const axios = require("axios");

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-04";

// GraphQL query to get products (first page)
const PRODUCTS_QUERY = `
query products($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      cursor
      node {
        id
        title
        productType
        status
        media(first: 1) {
          nodes {
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
        variants(first: 100) {
          edges {
            node {
              id
              sku
              title
              price
              inventoryQuantity
              image {
                url
              }
            }
          }
        }
      }
    }
  }
}
`;

async function graphqlRequest(shopDomain, accessToken, query, variables = {}) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  const res = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );
  if (res.data.errors) throw new Error(JSON.stringify(res.data.errors));
  return res.data.data;
}

async function fetchAllProductsGraphql(shopDomain, accessToken, onPage = null) {
  let cursor = null;
  let all = [];
  while (true) {
    const data = await graphqlRequest(shopDomain, accessToken, PRODUCTS_QUERY, {
      cursor,
    });
    const products = data.products.edges.map((e) => e.node);
    if (onPage) await onPage(products);
    all.push(...products);
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return all;
}

const GET_WEBHOOKS = `
  query {
    webhookSubscriptions(first: 50) {
      edges {
        node {
          id
          topic
        }
      }
    }
  }
`;

const DELETE_WEBHOOK = `
  mutation webhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      userErrors {
        field
        message
      }
      deletedWebhookSubscriptionId
    }
  }
`;
// Find inventory item by SKU via productVariants.[web:71][web:76]
const GET_INVENTORY_ITEM_BY_SKU = `
  query getInventoryItemBySku($sku: String!) {
    productVariants(first: 1, query: $sku) {
      edges {
        node {
          id
          sku
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

async function findInventoryItemIdBySku(shopDomain, accessToken, sku) {
  const data = await graphqlRequest(
    shopDomain,
    accessToken,
    GET_INVENTORY_ITEM_BY_SKU,
    { sku: `sku:${sku}` } // exact SKU search pattern.[web:71][web:74]
  );

  const edge = data.productVariants?.edges?.[0];
  const inventoryItemId = edge?.node?.inventoryItem?.id || null;

  if (!inventoryItemId) {
    throw new Error(`No inventory item found in Shopify for SKU ${sku}`);
  }

  return inventoryItemId;
}

async function deleteOldWebhooks(shopDomain, accessToken) {
  try {
    const data = await graphqlRequest(shopDomain, accessToken, GET_WEBHOOKS);
    const webhooks = data.webhookSubscriptions.edges.map((e) => e.node);

    for (const w of webhooks) {
      const result = await graphqlRequest(
        shopDomain,
        accessToken,
        DELETE_WEBHOOK,
        { id: w.id }
      );
      if (result.webhookSubscriptionDelete.userErrors.length > 0) {
        console.warn(
          "Failed to delete webhook",
          w.id,
          result.webhookSubscriptionDelete.userErrors
        );
      } else {
        console.log("Deleted old webhook:", w.id, w.topic);
      }
    }
  } catch (err) {
    console.error("Error deleting old webhooks:", err?.message || err);
  }
}

const CREATE_WEBHOOK = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      userErrors {
        field
        message
      }
      webhookSubscription {
        id
        topic
        endpoint {
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

async function createWebhook(shopDomain, accessToken, topic, callbackUrl) {
  const data = await graphqlRequest(shopDomain, accessToken, CREATE_WEBHOOK, {
    topic,
    callbackUrl,
  });

  if (data.webhookSubscriptionCreate.userErrors.length > 0) {
    console.error(
      "Failed to create webhook:",
      data.webhookSubscriptionCreate.userErrors
    );
    return null;
  }

  const webhook = data.webhookSubscriptionCreate.webhookSubscription;
  console.log(
    `✅ Webhook created successfully! Topic: ${webhook.topic}, Callback URL: ${webhook.endpoint.callbackUrl}, ID: ${webhook.id}`
  );
  return webhook;
}

const ORDER_CREATE_TOPIC = "ORDERS_CREATE";
const INVENTORY_LEVELS_UPDATE_TOPIC = "INVENTORY_LEVELS_UPDATE";

async function createInventoryWebhook(shopDomain, accessToken, callbackUrl) {
  return createWebhook(
    shopDomain,
    accessToken,
    INVENTORY_LEVELS_UPDATE_TOPIC,
    callbackUrl
  );
}

async function createOrderWebhook(shopDomain, accessToken, callbackUrl) {
  return createWebhook(
    shopDomain,
    accessToken,
    ORDER_CREATE_TOPIC,
    callbackUrl
  );
}

const GET_FULFILLMENT_ORDERS_QUERY = `
  query getFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      id
      fulfillmentOrders(first: 10) {
        edges {
          node {
            id
            status
          }
        }
      }
    }
  }
`;

// ✅ NEW: Mutation to create a fulfillment
const FULFILL_ORDER_MUTATION = `
  mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ✅ NEW: Function to fulfill an order in Shopify
async function fulfillOrder(shopDomain, accessToken, shopifyOrderId) {
  try {
    console.log(`🔍 Getting fulfillment orders for ${shopifyOrderId}...`);

    // Step 1: Get the fulfillment order IDs
    const orderData = await graphqlRequest(
      shopDomain,
      accessToken,
      GET_FULFILLMENT_ORDERS_QUERY,
      { orderId: shopifyOrderId }
    );

    if (!orderData.order) {
      throw new Error(`Order ${shopifyOrderId} not found in Shopify`);
    }

    // Step 2: Filter for OPEN fulfillment orders (ones that can be fulfilled)
    const fulfillmentOrders = orderData.order.fulfillmentOrders.edges
      .map((e) => e.node)
      .filter((fo) => fo.status === "OPEN");

    if (fulfillmentOrders.length === 0) {
      console.log(
        "⚠️ No fulfillment orders to fulfill (may already be fulfilled)"
      );
      return null;
    }

    console.log(
      `📋 Found ${fulfillmentOrders.length} fulfillment order(s) to fulfill`
    );

    // Step 3: Prepare fulfillment input
    const lineItemsByFulfillmentOrder = fulfillmentOrders.map((fo) => ({
      fulfillmentOrderId: fo.id,
    }));

    const fulfillmentInput = {
      lineItemsByFulfillmentOrder,
      notifyCustomer: true, // Send email to customer
    };

    console.log(`📤 Creating fulfillment in Shopify...`);

    // Step 4: Create the fulfillment
    const result = await graphqlRequest(
      shopDomain,
      accessToken,
      FULFILL_ORDER_MUTATION,
      { fulfillment: fulfillmentInput }
    );

    if (result.fulfillmentCreateV2.userErrors.length > 0) {
      console.error(
        "❌ Shopify fulfillment errors:",
        result.fulfillmentCreateV2.userErrors
      );
      throw new Error(JSON.stringify(result.fulfillmentCreateV2.userErrors));
    }

    const fulfillment = result.fulfillmentCreateV2.fulfillment;
    console.log(
      `✅ Fulfillment created! ID: ${fulfillment.id}, Status: ${fulfillment.status}`
    );

    return fulfillment;
  } catch (err) {
    console.error("❌ Error fulfilling order:", err?.message || err);
    throw err;
  }
}

// ✅ Cancel full order (optionally refund + restock)
const ORDER_CANCEL_MUTATION = `
  mutation orderCancel(
    $orderId: ID!,
    $refund: Boolean!,
    $restock: Boolean!,
    $reason: OrderCancelReason!
  ) {
    orderCancel(
      orderId: $orderId,
      refund: $refund,
      restock: $restock,
      reason: $reason
    ) {
      userErrors {
        field
        message
      }
    }
  }
`;

// ✅ Refund / return specific items
const REFUND_CREATE_MUTATION = `
  mutation refundCreate($input: RefundInput!) {
    refundCreate(input: $input) {
      refund {
        id
        createdAt
        totalRefundedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
      order {
        id
      }
    }
  }
`;

// ✅ FIXED: Simplified cancelOrder for 2025-04 API
async function cancelOrder(
  shopDomain,
  accessToken,
  shopifyOrderId,
  { refund = true, restock = true, reason = "CUSTOMER" } = {}
) {
  try {
    console.log(`🛑 Cancelling order ${shopifyOrderId}...`);

    const variables = {
      orderId: shopifyOrderId,
      refund,
      restock,
      reason,
    };

    const result = await graphqlRequest(
      shopDomain,
      accessToken,
      ORDER_CANCEL_MUTATION,
      variables
    );

    const payload = result.orderCancel;

    if (payload.userErrors && payload.userErrors.length > 0) {
      console.error("❌ Shopify orderCancel errors:", payload.userErrors);
      throw new Error(JSON.stringify(payload.userErrors));
    }

    console.log(`✅ Order ${shopifyOrderId} canceled`);
    return payload;
  } catch (err) {
    console.error("❌ Error canceling order:", err?.message || err);
    throw err;
  }
}

// ✅ FIXED: Use input wrapper like original
async function createRefund(
  shopDomain,
  accessToken,
  {
    orderId,
    lineItemId,
    quantity,
    amount,
    currencyCode,
    transactionId,
    locationId,
    note = null,
    notify = true,
    restockType = "RETURN",
  }
) {
  try {
    console.log(`↩️ Creating refund for order ${orderId}...`);

    const input = {
      orderId,
      notify,
      note,
      refundLineItems: [
        {
          lineItemId,
          quantity,
          restockType,
          locationId,
        },
      ],
      transactions: transactionId
        ? [
            {
              parentId: transactionId,
              kind: "REFUND",
              amount,
            },
          ]
        : [],
    };

    const result = await graphqlRequest(
      shopDomain,
      accessToken,
      REFUND_CREATE_MUTATION,
      { input } // ✅ Use { input } wrapper
    );

    const payload = result.refundCreate;

    if (payload.userErrors && payload.userErrors.length > 0) {
      console.error("❌ Shopify refundCreate errors:", payload.userErrors);
      throw new Error(JSON.stringify(payload.userErrors));
    }

    console.log(
      `✅ Refund created: ${payload.refund.id}, total: ${payload.refund.totalRefundedSet.shopMoney.amount} ${payload.refund.totalRefundedSet.shopMoney.currencyCode}`
    );

    return payload.refund;
  } catch (err) {
    console.error("❌ Error creating refund:", err?.message || err);
    throw err;
  }
}

// Query to fetch first shop location id
const GET_LOCATIONS_QUERY = `
  query {
    locations(first: 1) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

// ✅ NEW: Adjust inventory quantities
const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        reason
        referenceDocumentUri
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

// ✅ NEW: Set exact quantity in Shopify (no delta)
async function setInventoryQuantityExact(
  shopDomain,
  accessToken,
  {
    locationId, // gid://shopify/Location/...
    inventoryItemId, // gid://shopify/InventoryItem/...
    quantity, // absolute quantity you want in Shopify
    name = "on_hand", // "available" or "on_hand"
    reason = "correction",
    referenceDocumentUri = null,
    ignoreCompareQuantity = true, // overwrite without CAS
  }
) {
  const input = {
    name,
    reason,
    referenceDocumentUri,
    ignoreCompareQuantity,
    quantities: [
      {
        inventoryItemId,
        locationId,
        quantity,
        compareQuantity: null, // ignored when ignoreCompareQuantity = true
      },
    ],
  };

  const raw = await graphqlRequest(
    shopDomain,
    accessToken,
    INVENTORY_SET_QUANTITIES_MUTATION,
    { input }
  );

  // Depending on your graphqlRequest helper, data may be nested
  const payload = raw.data
    ? raw.data.inventorySetQuantities
    : raw.inventorySetQuantities;

  if (!payload) {
    console.error("Unexpected inventorySetQuantities response:", raw);
    throw new Error("inventorySetQuantities payload missing");
  }

  if (payload.userErrors && payload.userErrors.length > 0) {
    console.error(
      "❌ Shopify inventorySetQuantities errors:",
      payload.userErrors
    );
    throw new Error(JSON.stringify(payload.userErrors));
  }

  const group = payload.inventoryAdjustmentGroup;

  console.log("✅ Inventory SET.", {
    groupId: group?.id,
    reason: group?.reason,
    referenceDocumentUri: group?.referenceDocumentUri,
    changes: group?.changes,
  });

  return group;
}

// Fetch first shop location from Shopify
async function fetchShopLocationId(shopDomain, accessToken) {
  const data = await graphqlRequest(
    shopDomain,
    accessToken,
    GET_LOCATIONS_QUERY
  );
  const location = data.locations.edges[0]?.node;
  if (!location) {
    throw new Error("No locations found for store");
  }
  return location.id;
}

module.exports = {
  fetchAllProductsGraphql,
  graphqlRequest,
  createWebhook,
  deleteOldWebhooks,
  createOrderWebhook,
  fulfillOrder,
  cancelOrder,
  createRefund,
  fetchShopLocationId,
  createInventoryWebhook,
  setInventoryQuantityExact,
  findInventoryItemIdBySku,
};
