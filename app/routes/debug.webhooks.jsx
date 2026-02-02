import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  // Requires the merchant to be logged in (embedded admin)
  const { admin } = await authenticate.admin(request);

  const query = `#graphql
    query {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `;

  const res = await admin.graphql(query);
  const data = await res.json();

  const subs =
    data?.data?.webhookSubscriptions?.edges?.map((e) => e.node) ?? [];

  return new Response(JSON.stringify(subs, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};

