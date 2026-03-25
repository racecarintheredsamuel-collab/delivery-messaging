// ============================================================================
// PRODUCT TAG BROWSER — Resource Route (no UI)
// Handles product search and tag add/remove operations
// All operations use ACTION (POST) for reliable Shopify embedded auth
// ============================================================================

import { authenticate } from "../shopify.server";
import {
  SEARCH_PRODUCTS,
  GET_FILTER_OPTIONS,
  TAGS_ADD,
  TAGS_REMOVE,
} from "../graphql/queries";

// ============================================================================
// ACTION — All operations via POST for reliable auth in embedded apps
// ============================================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("productAction") || formData.get("action");

  // ------ Search products ------
  if (actionType === "searchProducts") {
    const search = formData.get("search") || "";
    const vendor = formData.get("vendor") || "";
    const productType = formData.get("productType") || "";
    const collectionId = formData.get("collectionId") || "";
    const tag = formData.get("tag") || "";
    const after = formData.get("after") || null;
    const first = parseInt(formData.get("first") || "25", 10);
    const loadFilters = formData.get("loadFilters") === "true";
    const appendMode = formData.get("appendMode") === "true";

    // Build Shopify search query string
    const queryParts = [];
    if (search) queryParts.push(`title:*${search}*`);
    if (vendor) queryParts.push(`vendor:"${vendor}"`);
    if (productType) queryParts.push(`product_type:"${productType}"`);
    if (tag) queryParts.push(`tag:"${tag}"`);
    if (collectionId) {
      const numericId = collectionId.replace("gid://shopify/Collection/", "");
      queryParts.push(`collection_id:${numericId}`);
    }
    const query = queryParts.join(" AND ") || null;

    const productsRes = await admin.graphql(SEARCH_PRODUCTS, {
      variables: { first, after, query },
    });
    const productsJson = await productsRes.json();
    const productsData = productsJson.data?.products;

    const products = (productsData?.edges || []).map((edge) => {
      const node = edge.node;
      return {
        id: node.id,
        title: node.title,
        handle: node.handle,
        vendor: node.vendor,
        productType: node.productType,
        tags: node.tags,
        status: node.status,
        image: node.featuredMedia?.preview?.image?.url || null,
        imageAlt: node.featuredMedia?.preview?.image?.altText || node.title,
      };
    });

    const pageInfo = productsData?.pageInfo || {
      hasNextPage: false,
      endCursor: null,
    };

    const result = { ok: true, productAction: "searchProducts", products, pageInfo, appendMode };

    // Fetch filter options on initial load
    if (loadFilters) {
      const filtersRes = await admin.graphql(GET_FILTER_OPTIONS);
      const filtersJson = await filtersRes.json();
      const data = filtersJson.data;

      result.vendors = (data?.productVendors?.edges || [])
        .map((e) => e.node)
        .filter(Boolean);
      result.productTypes = (data?.productTypes?.edges || [])
        .map((e) => e.node)
        .filter(Boolean);
      result.collections = (data?.collections?.edges || []).map((e) => ({
        id: e.node.id,
        title: e.node.title,
      }));
    }

    return result;
  }

  // ------ Add or remove tag ------
  if (actionType === "addTag" || actionType === "removeTag") {
    const tag = formData.get("tag");
    const productIdsJson = formData.get("productIds");

    if (!tag || !productIdsJson) {
      return { ok: false, error: "Missing required fields" };
    }

    let productIds;
    try {
      productIds = JSON.parse(productIdsJson);
    } catch {
      return { ok: false, error: "Invalid productIds" };
    }

    const mutation = actionType === "addTag" ? TAGS_ADD : TAGS_REMOVE;
    const results = [];

    for (const productId of productIds) {
      try {
        const res = await admin.graphql(mutation, {
          variables: { id: productId, tags: [tag] },
        });
        const json = await res.json();
        const data =
          actionType === "addTag" ? json.data?.tagsAdd : json.data?.tagsRemove;
        const errors = data?.userErrors || [];

        if (errors.length > 0) {
          results.push({ id: productId, ok: false, error: errors[0].message });
        } else {
          const updatedTags = data?.node?.tags || [];
          results.push({ id: productId, ok: true, tags: updatedTags });
        }
      } catch (err) {
        results.push({ id: productId, ok: false, error: err.message });
      }
    }

    return { ok: true, productAction: actionType, results };
  }

  return { ok: false, error: "Unknown action" };
};
