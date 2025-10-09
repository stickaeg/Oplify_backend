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

module.exports = {
  fetchAllProductsGraphql,
  graphqlRequest,
  createWebhook,
  deleteOldWebhooks,
  createOrderWebhook,
};
