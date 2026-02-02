import { safeLogError } from "../utils/validation";

const NAMESPACE = "delivery_rules";
const CONFIG_KEY = "config";
const SETTINGS_KEY = "settings";

const CONFIG_NAME = "Delivery Info — Rule Configuration";
const CONFIG_DESCRIPTION =
  "Managed by the Delivery Info app. Changes should be made in the app, not here.";

const SETTINGS_NAME = "Delivery Info — Global Settings";
const SETTINGS_DESCRIPTION =
  "Global settings managed by the Delivery Info app.";

const GET_DEFINITION = `#graphql
  query GetDeliveryRulesDefinition($namespace: String!, $key: String!) {
    metafieldDefinitions(first: 1, ownerType: SHOP, namespace: $namespace, key: $key) {
      nodes {
        id
        name
        description
        type { name }
        access { storefront }
      }
    }
  }
`;

const CREATE_DEFINITION = `#graphql
  mutation CreateDeliveryRulesDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        description
        type { name }
        access { storefront }
      }
      userErrors { field message }
    }
  }
`;

const UPDATE_DEFINITION = `#graphql
  mutation UpdateDeliveryRulesDefinition($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
        access { storefront }
      }
      userErrors { field message }
    }
  }
`;

async function ensureMetafieldDefinition(admin, key, name, description) {
  // 1) Fetch existing definition (if any)
  const defRes = await admin.graphql(GET_DEFINITION, {
    variables: { namespace: NAMESPACE, key },
  });
  const defJson = await defRes.json();
  if (defJson.errors) {
    safeLogError(`Failed to fetch metafield definition ${key}`, defJson.errors);
    return { ok: false, errors: defJson.errors };
  }
  const existing = defJson?.data?.metafieldDefinitions?.nodes?.[0];

  // 2) If it exists, check if storefront access needs updating
  if (existing) {
    // Only update if storefront access is not PUBLIC_READ
    if (existing.access?.storefront !== "PUBLIC_READ") {
      const updateRes = await admin.graphql(UPDATE_DEFINITION, {
        variables: {
          definition: {
            namespace: NAMESPACE,
            key: key,
            ownerType: "SHOP",
            name: name,
            description: description,
            access: { storefront: "PUBLIC_READ" },
          },
        },
      });

      const updateJson = await updateRes.json();
      if (updateJson.errors) {
        safeLogError(`Failed to update metafield definition ${key}`, updateJson.errors);
        return { ok: false, errors: updateJson.errors };
      }
      const errors = updateJson?.data?.metafieldDefinitionUpdate?.userErrors ?? [];
      if (errors.length) {
        safeLogError(`Failed to update metafield definition ${key}`, errors);
        return { ok: false, errors };
      }
      return { ok: true, created: false, updated: true };
    }
    return { ok: true, created: false, updated: false };
  }

  // 3) Otherwise create it with PUBLIC_READ storefront access
  const createRes = await admin.graphql(CREATE_DEFINITION, {
    variables: {
      definition: {
        name: name,
        namespace: NAMESPACE,
        key: key,
        ownerType: "SHOP",
        type: "json",
        description: description,
        access: { storefront: "PUBLIC_READ" },
      },
    },
  });

  const createJson = await createRes.json();
  if (createJson.errors) {
    safeLogError(`Failed to create metafield definition ${key}`, createJson.errors);
    return { ok: false, errors: createJson.errors };
  }
  const errors = createJson?.data?.metafieldDefinitionCreate?.userErrors ?? [];

  if (errors.length) {
    safeLogError(`Failed to create metafield definition ${key}`, errors);
    return { ok: false, errors };
  }

  return { ok: true, created: true, updated: false };
}

// In-memory cache for definition status (per-process, resets on deploy)
// Key: shop domain extracted from admin context, Value: timestamp
const definitionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function ensureDeliveryRulesDefinition(admin, shopDomain = null) {
  // Check cache - skip API calls if recently verified
  if (shopDomain) {
    const cached = definitionCache.get(shopDomain);
    if (cached && Date.now() - cached < CACHE_TTL_MS) {
      return { ok: true, cached: true };
    }
  }

  // Run both definition checks in parallel
  const [configResult, settingsResult] = await Promise.all([
    ensureMetafieldDefinition(admin, CONFIG_KEY, CONFIG_NAME, CONFIG_DESCRIPTION),
    ensureMetafieldDefinition(admin, SETTINGS_KEY, SETTINGS_NAME, SETTINGS_DESCRIPTION),
  ]);

  // Return combined result
  if (!configResult.ok || !settingsResult.ok) {
    return {
      ok: false,
      errors: [
        ...(configResult.errors || []),
        ...(settingsResult.errors || []),
      ],
    };
  }

  // Cache successful result
  if (shopDomain) {
    definitionCache.set(shopDomain, Date.now());
  }

  return {
    ok: true,
    config: configResult,
    settings: settingsResult,
  };
}


