import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
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
  const json = await res.json();

  const subs =
    json?.data?.webhookSubscriptions?.edges?.map((e) => ({
      topic: e.node.topic,
      callbackUrl: e.node.endpoint?.callbackUrl ?? null,
      endpointType: e.node.endpoint?.__typename ?? null,
    })) ?? [];

  return new Response(JSON.stringify(subs, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};
