// ============================================================================
// GRAPHQL QUERIES & MUTATIONS
// Shared GraphQL operations for Shopify Admin API
// ============================================================================

/**
 * Query to fetch shop ID along with config and settings metafields
 * Used by both Editor (app._index) and Settings (app.settings) pages
 */
export const GET_SHOP_DELIVERY_DATA = `#graphql
  query GetShopDeliveryData($namespace: String!, $configKey: String!, $settingsKey: String!) {
    shop {
      id
      currencyCode
      config: metafield(namespace: $namespace, key: $configKey) {
        id
        type
        value
      }
      settings: metafield(namespace: $namespace, key: $settingsKey) {
        id
        type
        value
      }
    }
  }
`;

/**
 * Simple query to get shop ID
 * Used when saving metafields (need ownerId)
 */
export const GET_SHOP_ID = `#graphql
  query GetShopId {
    shop {
      id
    }
  }
`;

/**
 * Mutation to save metafields
 * Used for saving both config and settings
 * @param metafields - Array of MetafieldsSetInput objects
 */
export const SET_METAFIELDS = `#graphql
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        type
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Mutation to save metafields (minimal response - for action handlers)
 * Same as SET_METAFIELDS but only returns userErrors
 */
export const SET_METAFIELDS_MINIMAL = `#graphql
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Mutation to delete metafields by ownerId, namespace, and key
 * Used for dev reset functionality
 */
export const DELETE_METAFIELDS = `#graphql
  mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================================================
// CONSTANTS
// ============================================================================

export const METAFIELD_NAMESPACE = "delivery_rules";
export const CONFIG_KEY = "config";
export const SETTINGS_KEY = "settings";
export const ICONS_KEY = "icons";
