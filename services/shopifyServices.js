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

async function createOrderWebhook(shopDomain, accessToken, callbackUrl) {
  return createWebhook(
    shopDomain,
    accessToken,
    ORDER_CREATE_TOPIC,
    callbackUrl
  );
}

// ✅ NEW: Query to get fulfillment orders for an order
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

module.exports = {
  fetchAllProductsGraphql,
  graphqlRequest,
  createWebhook,
  deleteOldWebhooks,
  createOrderWebhook,
  fulfillOrder, // ✅ NEW export
};
