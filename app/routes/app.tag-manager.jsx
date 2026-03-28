// ============================================================================
// TAG MANAGER — Standalone page for managing product tags
// Browse products, search, filter, add/remove tags visually
// ============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  SEARCH_PRODUCTS,
  GET_FILTER_OPTIONS,
  TAGS_ADD,
  TAGS_REMOVE,
  GET_SHOP_DELIVERY_DATA,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
} from "../graphql/queries";

// ============================================================================
// Prevent loader revalidation after tag operations
// ============================================================================
export function shouldRevalidate({ formMethod }) {
  if (formMethod === "POST") return false;
  return true;
}

// ============================================================================
// LOADER — Fetch initial products, filter options, and rule tags from config
// ============================================================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch products (newest first), filter options, and config in parallel
  const [productsRes, filtersRes, configRes] = await Promise.all([
    admin.graphql(SEARCH_PRODUCTS, { variables: { first: 25, after: null, query: null } }),
    admin.graphql(GET_FILTER_OPTIONS),
    admin.graphql(GET_SHOP_DELIVERY_DATA, {
      variables: { namespace: METAFIELD_NAMESPACE, configKey: CONFIG_KEY, settingsKey: SETTINGS_KEY, iconsKey: "icons" },
    }),
  ]);

  const productsJson = await productsRes.json();
  const filtersJson = await filtersRes.json();
  const configJson = await configRes.json();

  // Parse products
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
  const pageInfo = productsData?.pageInfo || { hasNextPage: false, endCursor: null };

  // Parse filter options
  const filtersData = filtersJson.data;
  const vendors = (filtersData?.productVendors?.edges || []).map((e) => e.node).filter(Boolean);
  const productTypes = (filtersData?.productTypes?.edges || []).map((e) => e.node).filter(Boolean);
  const collections = (filtersData?.collections?.edges || []).map((e) => ({ id: e.node.id, title: e.node.title }));

  // Parse rule tags from config
  const configMf = configJson.data?.shop?.config;
  let ruleTags = [];
  try {
    const config = configMf?.value ? JSON.parse(configMf.value) : null;
    if (config?.profiles) {
      for (const profile of config.profiles) {
        for (const rule of (profile.rules || [])) {
          for (const tag of (rule.match?.tags || [])) {
            if (tag && !ruleTags.includes(tag)) ruleTags.push(tag);
          }
        }
      }
    }
  } catch { /* ignore parse errors */ }

  // Parse all store tags (excluding rule tags — case-insensitive comparison)
  const allStoreTags = (filtersData?.productTags?.edges || []).map((e) => e.node).filter(Boolean);
  const ruleTagsLower = ruleTags.map((t) => t.toLowerCase());
  const storeTags = allStoreTags.filter((t) => !ruleTagsLower.includes(t.toLowerCase())).sort();

  return { products, pageInfo, vendors, productTypes, collections, ruleTags, storeTags };
};

// ============================================================================
// ACTION — Handle search, add tag, remove tag
// ============================================================================
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("productAction");

  // ------ Search products ------
  if (actionType === "searchProducts") {
    const search = formData.get("search") || "";
    const vendor = formData.get("vendor") || "";
    const productType = formData.get("productType") || "";
    const collectionId = formData.get("collectionId") || "";
    const tag = formData.get("tag") || "";
    const after = formData.get("after") || null;
    const first = parseInt(formData.get("first") || "25", 10);
    const appendMode = formData.get("appendMode") === "true";

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

    const productsRes = await admin.graphql(SEARCH_PRODUCTS, { variables: { first, after, query } });
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

    const pageInfo = productsData?.pageInfo || { hasNextPage: false, endCursor: null };
    return { ok: true, productAction: "searchProducts", products, pageInfo, appendMode };
  }

  // ------ Add or remove tag ------
  if (actionType === "addTag" || actionType === "removeTag") {
    const tag = formData.get("tag");
    const productIdsJson = formData.get("productIds");
    if (!tag || !productIdsJson) return { ok: false, error: "Missing required fields" };

    let productIds;
    try { productIds = JSON.parse(productIdsJson); } catch { return { ok: false, error: "Invalid productIds" }; }

    const mutation = actionType === "addTag" ? TAGS_ADD : TAGS_REMOVE;
    const results = [];

    for (const productId of productIds) {
      try {
        const res = await admin.graphql(mutation, { variables: { id: productId, tags: [tag] } });
        const json = await res.json();
        const data = actionType === "addTag" ? json.data?.tagsAdd : json.data?.tagsRemove;
        const errors = data?.userErrors || [];
        if (errors.length > 0) {
          results.push({ id: productId, ok: false, error: errors[0].message });
        } else {
          results.push({ id: productId, ok: true, tags: data?.node?.tags || [] });
        }
      } catch (err) {
        results.push({ id: productId, ok: false, error: err.message });
      }
    }
    return { ok: true, productAction: actionType, results };
  }

  return { ok: false, error: "Unknown action" };
};

// ============================================================================
// TAG MANAGER PAGE COMPONENT
// ============================================================================
export default function TagManagerPage() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [products, setProducts] = useState(loaderData.products || []);
  const [pageInfo, setPageInfo] = useState(loaderData.pageInfo || { hasNextPage: false, endCursor: null });
  const [search, setSearch] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCollection, setFilterCollection] = useState("");
  const [workingTag, setWorkingTag] = useState((loaderData.ruleTags || [])[0] || "");
  const [pendingIds, setPendingIds] = useState(new Set());
  const [newTagInput, setNewTagInput] = useState("");
  const [showNoTagOnly, setShowNoTagOnly] = useState(false);
  const [showTaggedOnly, setShowTaggedOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  const searchTimerRef = useRef(null);
  const filteredCountRef = useRef(0);
  const lastSubmitRef = useRef(null);
  const retryCountRef = useRef(0);

  const vendors = loaderData.vendors || [];
  const productTypes = loaderData.productTypes || [];
  const collections = loaderData.collections || [];
  const ruleTags = loaderData.ruleTags || [];
  const [removedStoreTags, setRemovedStoreTags] = useState(new Set());
  const storeTags = (loaderData.storeTags || []).filter((t) => !removedStoreTags.has(t.toLowerCase()));
  const [storeTagSearch, setStoreTagSearch] = useState("");
  const [showAllStoreTags, setShowAllStoreTags] = useState(false);
  const [createdTag, setCreatedTag] = useState(null); // temporary tag before applied to a product
  const [appliedCreatedTags, setAppliedCreatedTags] = useState(new Set()); // created tags that were applied

  // ---------------------------------------------------------------------------
  // Submit helper
  // ---------------------------------------------------------------------------
  const submitAction = useCallback((data) => {
    const formData = new FormData();
    formData.set("productAction", data.action);
    for (const [key, val] of Object.entries(data)) {
      if (key !== "action" && val != null && val !== "") formData.set(key, val);
    }
    lastSubmitRef.current = data;
    retryCountRef.current = 0;
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher]);

  // ---------------------------------------------------------------------------
  // Retry on auth failure
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (fetcher.state === "idle" && lastSubmitRef.current && retryCountRef.current < 2) {
      const data = fetcher.data;
      if (!data && lastSubmitRef.current) {
        retryCountRef.current += 1;
        const retryData = lastSubmitRef.current;
        setTimeout(() => {
          const formData = new FormData();
          formData.set("productAction", retryData.action);
          for (const [key, val] of Object.entries(retryData)) {
            if (key !== "action" && val != null && val !== "") formData.set(key, val);
          }
          fetcher.submit(formData, { method: "POST" });
        }, 500);
      }
    }
  }, [fetcher.state, fetcher.data]);

  // ---------------------------------------------------------------------------
  // Handle fetcher responses
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    lastSubmitRef.current = null;
    retryCountRef.current = 0;
    if (data.productAction === "searchProducts") {
      if (data.appendMode) {
        setProducts((prev) => [...prev, ...(data.products || [])]);
      } else {
        setProducts(data.products || []);
      }
      setPageInfo(data.pageInfo || { hasNextPage: false, endCursor: null });
      setLoading(false);
    }
    if (data.productAction === "addTag" || data.productAction === "removeTag") {
      let updatedProducts = products;
      if (data.ok && data.results) {
        updatedProducts = products.map((p) => {
          const result = data.results.find((r) => r.id === p.id);
          return result?.ok ? { ...p, tags: result.tags } : p;
        });
        setProducts(updatedProducts);
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        (data.results || []).forEach((r) => next.delete(r.id));
        return next;
      });
      // If a tag was removed, check if it still exists on any loaded product
      if (data.productAction === "removeTag") {
        const tagRemoved = workingTag;
        const stillExists = updatedProducts.some((p) =>
          p.tags.some((t) => t.toLowerCase() === tagRemoved.toLowerCase())
        );
        if (!stillExists) {
          // Clean up created tags
          setAppliedCreatedTags((prev) => {
            const next = new Set(prev);
            next.forEach((t) => {
              if (t.toLowerCase() === tagRemoved.toLowerCase()) next.delete(t);
            });
            return next;
          });
          if (createdTag && createdTag.toLowerCase() === tagRemoved.toLowerCase()) {
            setCreatedTag(null);
          }
          // Hide store tag if no loaded products have it
          setRemovedStoreTags((prev) => new Set([...prev, tagRemoved.toLowerCase()]));
        }
      }
    }
  }, [fetcher.data]);

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  const submitSearch = useCallback((opts = {}) => {
    setLoading(true);
    submitAction({
      action: "searchProducts",
      search: opts.search ?? search,
      vendor: opts.vendor ?? filterVendor,
      productType: opts.productType ?? filterType,
      collectionId: opts.collectionId ?? filterCollection,
      first: "25",
      after: opts.after || "",
      appendMode: opts.after ? "true" : "",
    });
  }, [search, filterVendor, filterType, filterCollection, submitAction]);

  const triggerSearch = useCallback((overrides = {}) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => submitSearch(overrides), 300);
  }, [submitSearch]);

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------
  const handleSearchChange = (val) => { setSearch(val); triggerSearch({ search: val }); };
  const handleVendorChange = (val) => { setFilterVendor(val); triggerSearch({ vendor: val }); };
  const handleTypeChange = (val) => { setFilterType(val); triggerSearch({ productType: val }); };
  const handleCollectionChange = (val) => { setFilterCollection(val); triggerSearch({ collectionId: val }); };

  const handleTagPillClick = (tag) => { setWorkingTag(tag); };

  const handleNewTag = () => {
    const tag = newTagInput.trim();
    if (!tag) return;
    // Don't create if it already exists in rule tags or store tags
    const allExisting = [...ruleTags, ...storeTags].map((t) => t.toLowerCase());
    if (allExisting.includes(tag.toLowerCase())) {
      // Tag already exists — just select it
      setWorkingTag(tag);
      setNewTagInput("");
      return;
    }
    setCreatedTag(tag);
    setWorkingTag(tag);
    setNewTagInput("");
  };

  const handleClearFilters = () => {
    setSearch("");
    setFilterVendor("");
    setFilterType("");
    setFilterCollection("");
    submitSearch({ search: "", vendor: "", productType: "", collectionId: "" });
  };

  const handleLoadMore = () => {
    if (!pageInfo.endCursor) return;
    submitSearch({ after: pageInfo.endCursor });
  };

  // ---------------------------------------------------------------------------
  // Tag operations
  // ---------------------------------------------------------------------------
  const handleAddTag = (productId) => {
    setPendingIds((prev) => new Set([...prev, productId]));
    submitAction({ action: "addTag", tag: workingTag, productIds: JSON.stringify([productId]) });
    // Un-hide store tag if it was previously removed
    setRemovedStoreTags((prev) => {
      if (!prev.has(workingTag.toLowerCase())) return prev;
      const next = new Set(prev);
      next.delete(workingTag.toLowerCase());
      return next;
    });
    // If this is a created tag being applied for the first time, mark it as applied
    if (createdTag && workingTag.toLowerCase() === createdTag.toLowerCase()) {
      setAppliedCreatedTags((prev) => new Set([...prev, createdTag]));
    }
  };

  const handleRemoveTag = (productId) => {
    setPendingIds((prev) => new Set([...prev, productId]));
    submitAction({ action: "removeTag", tag: workingTag, productIds: JSON.stringify([productId]) });
  };

  // ---------------------------------------------------------------------------
  // Filtered products
  // ---------------------------------------------------------------------------
  const hasActiveTag = workingTag.trim().length > 0;

  const filteredProducts = useMemo(() => {
    const ruleTagsLc = ruleTags.map((t) => t.toLowerCase());
    if (showNoTagOnly) return products.filter((p) => !p.tags.some((t) => ruleTagsLc.includes(t.toLowerCase())));
    if (showTaggedOnly) return products.filter((p) => p.tags.some((t) => t.toLowerCase() === workingTag.toLowerCase()));
    return products;
  }, [products, showNoTagOnly, showTaggedOnly, workingTag, ruleTags]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <s-page heading="Tag Manager">
      <style>{`html { scrollbar-gutter: stable; }`}</style>
      <s-section>
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          overflow: "hidden",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
        }}>

          {/* ---- Header ---- */}
          <div style={{
            padding: "12px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#303030" }}>
                Product Tag Manager
              </h2>
              <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#616161" }}>
                Browse products and manage tags used by your delivery messaging rules.
              </p>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                onClick={() => { setShowTaggedOnly((prev) => !prev); setShowNoTagOnly(false); }}
                style={{
                  padding: "5px 12px", borderRadius: 6,
                  border: showTaggedOnly ? "1px solid #86efac" : "1px solid #d1d5db",
                  background: showTaggedOnly ? "#dcfce7" : "white",
                  color: showTaggedOnly ? "#15803d" : "#303030",
                  fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#15803d" style={{ width: 24, height: 24, flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12a4.49 4.49 0 0 1-1.549 3.397 4.491 4.491 0 0 1-1.307 3.497 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.49 4.49 0 0 1-3.498-1.306 4.491 4.491 0 0 1-1.307-3.498A4.49 4.49 0 0 1 2.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 0 1 1.307-3.497 4.49 4.49 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                </svg>
                Tagged
              </button>
              <button
                onClick={() => { setShowNoTagOnly((prev) => !prev); setShowTaggedOnly(false); }}
                style={{
                  padding: "5px 12px", borderRadius: 6,
                  border: showNoTagOnly ? "1px solid #9ca3af" : "1px solid #d1d5db",
                  background: showNoTagOnly ? "#f3f4f6" : "white",
                  color: showNoTagOnly ? "#6b7280" : "#303030",
                  fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#8c9196" style={{ width: 24, height: 24, flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clipRule="evenodd" />
                </svg>
                Untagged
              </button>
            </div>
          </div>

          {/* ---- Rule Tags ---- */}
          <div style={{
            padding: "10px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}>
            {ruleTags.length > 0 && (
              <>
                <span style={{ fontSize: 12, color: "#8c9196", marginRight: 4 }}>Rule tags:</span>
                {ruleTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => handleTagPillClick(t)}
                    style={{
                      padding: "3px 10px", borderRadius: 12,
                      border: "1px solid " + (t === workingTag ? "#0369a1" : "#d1d5db"),
                      background: t === workingTag ? "#e0f2fe" : "white",
                      color: t === workingTag ? "#0369a1" : "#303030",
                      fontSize: 12, fontWeight: 500, cursor: "pointer",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </>
            )}
            {ruleTags.length === 0 && (
              <span style={{ fontSize: 12, color: "#8c9196" }}>No rule tags configured yet. Create tags in the Messages Editor.</span>
            )}
          </div>

          {/* ---- Store Tags ---- */}
          {(() => {
            const filtered = storeTagSearch
              ? storeTags.filter((t) => t.toLowerCase().includes(storeTagSearch.toLowerCase()))
              : storeTags;
            const visible = showAllStoreTags ? filtered : filtered.slice(0, 20);
            const hasMore = filtered.length > 20;
            // Show created tag as temporary pill if it's not already in store/rule tags
            const showCreatedPill = createdTag && !appliedCreatedTags.has(createdTag)
              && !storeTags.some((t) => t.toLowerCase() === createdTag.toLowerCase())
              && !ruleTags.some((t) => t.toLowerCase() === createdTag.toLowerCase());
            // Show applied created tags as normal store tag pills
            const appliedPills = [...appliedCreatedTags].filter(
              (t) => !storeTags.some((st) => st.toLowerCase() === t.toLowerCase())
                && !ruleTags.some((rt) => rt.toLowerCase() === t.toLowerCase())
            );
            return (
              <div style={{
                padding: "10px 20px",
                borderBottom: "1px solid #e5e7eb",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "start",
              }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#8c9196", marginRight: 4 }}>Store tags:</span>
                  {/* Temporary created tag — off colour until applied */}
                  {showCreatedPill && (
                    <button
                      onClick={() => handleTagPillClick(createdTag)}
                      style={{
                        padding: "3px 10px", borderRadius: 12,
                        border: "1px dashed " + (createdTag === workingTag ? "#0369a1" : "#c084fc"),
                        background: createdTag === workingTag ? "#e0f2fe" : "#faf5ff",
                        color: createdTag === workingTag ? "#0369a1" : "#9333ea",
                        fontSize: 12, fontWeight: 500, cursor: "pointer",
                      }}
                    >
                      {createdTag}
                    </button>
                  )}
                  {/* Applied created tags — shown as normal store tags */}
                  {appliedPills.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTagPillClick(t)}
                      style={{
                        padding: "3px 10px", borderRadius: 12,
                        border: "1px solid " + (t === workingTag ? "#0369a1" : "#e5e7eb"),
                        background: t === workingTag ? "#e0f2fe" : "#f9fafb",
                        color: t === workingTag ? "#0369a1" : "#6b7280",
                        fontSize: 12, fontWeight: 500, cursor: "pointer",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  {visible.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTagPillClick(t)}
                      style={{
                        padding: "3px 10px", borderRadius: 12,
                        border: "1px solid " + (t === workingTag ? "#0369a1" : "#e5e7eb"),
                        background: t === workingTag ? "#e0f2fe" : "#f9fafb",
                        color: t === workingTag ? "#0369a1" : "#6b7280",
                        fontSize: 12, fontWeight: 500, cursor: "pointer",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  {hasMore && !showAllStoreTags && (
                    <button
                      onClick={() => setShowAllStoreTags(true)}
                      style={{
                        padding: "3px 10px", borderRadius: 12,
                        border: "1px solid #d1d5db", background: "white",
                        color: "#6b7280", fontSize: 12, cursor: "pointer",
                      }}
                    >
                      +{filtered.length - 20} more
                    </button>
                  )}
                  {hasMore && showAllStoreTags && (
                    <button
                      onClick={() => setShowAllStoreTags(false)}
                      style={{
                        padding: "3px 10px", borderRadius: 12,
                        border: "1px solid #d1d5db", background: "white",
                        color: "#6b7280", fontSize: 12, cursor: "pointer",
                      }}
                    >
                      Show less
                    </button>
                  )}
                  {storeTags.length === 0 && !showCreatedPill && appliedPills.length === 0 && (
                    <span style={{ fontSize: 12, color: "#8c9196" }}>No store tags found.</span>
                  )}
                </div>
                {/* Search + Create — pinned top right, stacked */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                  <input
                    type="text"
                    placeholder="Search tags..."
                    value={storeTagSearch}
                    onChange={(e) => setStoreTagSearch(e.target.value)}
                    style={{
                      padding: "3px 8px", borderRadius: 6, border: "1px solid #d1d5db",
                      fontSize: 12, width: 190, outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      type="text"
                      placeholder="Tag name..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleNewTag(); }}
                      style={{
                        padding: "3px 8px", borderRadius: 6, border: "1px solid #d1d5db",
                        fontSize: 12, flex: 1, outline: "none",
                      }}
                    />
                    <button
                      onClick={handleNewTag}
                      disabled={!newTagInput.trim()}
                      style={{
                        padding: "3px 10px", borderRadius: 6, border: "1px solid #d1d5db",
                        background: newTagInput.trim() ? "#0369a1" : "#f3f4f6",
                        color: newTagInput.trim() ? "white" : "#9ca3af",
                        fontSize: 12, fontWeight: 500,
                        cursor: newTagInput.trim() ? "pointer" : "not-allowed",
                      }}
                  >
                    Create
                  </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ---- Search + Filters ---- */}
          <div style={{
            padding: "12px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}>
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                flex: "1 1 200px", padding: "6px 10px", borderRadius: 6,
                border: "1px solid #d1d5db", fontSize: 13, outline: "none",
              }}
            />
            <select value={filterVendor} onChange={(e) => handleVendorChange(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterType} onChange={(e) => handleTypeChange(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
              <option value="">All types</option>
              {productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterCollection} onChange={(e) => handleCollectionChange(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
              <option value="">All collections</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button onClick={handleClearFilters}
              style={{
                padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db",
                background: "white", fontSize: 13, cursor: "pointer", color: "#616161",
              }}>
              Clear
            </button>
          </div>

          {/* ---- Product List ---- */}
          <div style={{ minHeight: 200 }}>
            {loading && products.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "#8c9196", fontSize: 14 }}>
                Loading products...
              </div>
            )}

            {!loading && filteredProducts.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "#8c9196", fontSize: 14 }}>
                No products found.
              </div>
            )}

            {filteredProducts.map((product) => {
              const isTagged = product.tags.some((t) => t.toLowerCase() === workingTag.toLowerCase());
              const isPending = pendingIds.has(product.id);

              return (
                <div key={product.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 20px", borderBottom: "1px solid #f3f4f6",
                }}>
                  {/* Thumbnail */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 6, border: "1px solid #e5e7eb",
                    overflow: "hidden", flexShrink: 0, background: "#f9fafb",
                  }}>
                    {product.image ? (
                      <img src={product.image} alt={product.imageAlt} style={{ width: 40, height: 40, objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db", fontSize: 16 }}>☐</div>
                    )}
                  </div>

                  {/* Product info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "#303030", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                      {product.title}
                    </span>
                    <div style={{ fontSize: 12, color: "#8c9196" }}>
                      {product.vendor}{product.productType ? ` · ${product.productType}` : ""}
                    </div>
                  </div>

                  {/* Tag status */}
                  <div style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                    background: isTagged ? "#dcfce7" : "#f3f4f6",
                    color: isTagged ? "#15803d" : "#8c9196",
                    flexShrink: 0,
                  }}>
                    {isTagged ? "Tagged" : "Untagged"}
                  </div>

                  {/* Action button */}
                  {hasActiveTag && (
                    <button
                      onClick={() => isTagged ? handleRemoveTag(product.id) : handleAddTag(product.id)}
                      disabled={isPending}
                      style={{
                        padding: "5px 12px", borderRadius: 6,
                        border: "1px solid " + (isTagged ? "#fecaca" : "#d1d5db"),
                        background: isTagged ? "#fef2f2" : "white",
                        color: isTagged ? "#dc2626" : "#303030",
                        fontSize: 12, fontWeight: 500,
                        cursor: isPending ? "wait" : "pointer",
                        opacity: isPending ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {isPending ? "..." : isTagged ? "Remove" : "Add tag"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* ---- Footer ---- */}
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span style={{ fontSize: 12, color: "#8c9196" }}>
              {filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""} shown
            </span>
            {pageInfo.hasNextPage && (
              <button onClick={handleLoadMore}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db",
                  background: "white", fontSize: 13, cursor: "pointer", color: "#303030",
                }}>
                Load more
              </button>
            )}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}
