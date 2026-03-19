/**
 * DEV ONLY - Factory Reset Route
 * Deletes all metafield definitions for fresh install testing
 * DELETE THIS FILE BEFORE DISTRIBUTION
 */
import { authenticate } from "../shopify.server";
import { METAFIELD_NAMESPACE } from "../graphql/queries";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Find all metafield definitions in our namespace
  const findRes = await admin.graphql(`#graphql
    query {
      metafieldDefinitions(first: 50, ownerType: SHOP, namespace: "${METAFIELD_NAMESPACE}") {
        edges {
          node {
            id
            name
            key
          }
        }
      }
    }
  `);

  const findJson = await findRes.json();
  const definitions = findJson?.data?.metafieldDefinitions?.edges || [];

  const deleted = [];
  const errors = [];

  // Delete each definition (and its values)
  for (const edge of definitions) {
    const def = edge.node;
    try {
      const deleteRes = await admin.graphql(`#graphql
        mutation DeleteMetafieldDefinition($id: ID!) {
          metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: true) {
            deletedDefinitionId
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: { id: def.id }
      });

      const deleteJson = await deleteRes.json();
      const userErrors = deleteJson?.data?.metafieldDefinitionDelete?.userErrors || [];

      if (userErrors.length > 0) {
        errors.push({ key: def.key, errors: userErrors });
      } else {
        deleted.push(def.key);
      }
    } catch (err) {
      errors.push({ key: def.key, error: err.message });
    }
  }

  return new Response(JSON.stringify({
    success: true,
    message: "Factory reset complete. Uninstall and reinstall the app for a fresh start.",
    found: definitions.length,
    deleted,
    errors,
  }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};
