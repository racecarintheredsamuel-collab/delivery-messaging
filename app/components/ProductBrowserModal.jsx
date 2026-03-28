// ============================================================================
// PRODUCT BROWSER MODAL
// Browse products and add/remove tags visually
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";

export function ProductBrowserModal({ open, onClose, currentTag, currentRuleTags = [], allProfileTags, onAddTagToRule, rules, ruleName, currentRuleId }) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [products, setProducts] = useState([]);
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });
  const [search, setSearch] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCollection, setFilterCollection] = useState("");
  const [workingTag, setWorkingTag] = useState(currentTag || "");
  const [vendors, setVendors] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [collections, setCollections] = useState([]);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [pendingIds, setPendingIds] = useState(new Set());
  const [newTagInput, setNewTagInput] = useState("");
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [showNoTagOnly, setShowNoTagOnly] = useState(false);
  const [showTaggedOnly, setShowTaggedOnly] = useState(false);
  const [addedToRule, setAddedToRule] = useState(new Set());

  const searchTimerRef = useRef(null);
  const initialLoadRef = useRef(false);
  const filteredCountRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const productFetcher = useFetcher();
  const lastSubmitRef = useRef(null);
  const retryCountRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Submit helper — uses React Router fetcher for Shopify auth
  // ---------------------------------------------------------------------------
  const submitProductAction = useCallback((data) => {
    const formData = new FormData();
    formData.set("productAction", data.action);
    for (const [key, val] of Object.entries(data)) {
      if (key !== "action" && val != null && val !== "") formData.set(key, val);
    }
    lastSubmitRef.current = data;
    retryCountRef.current = 0;
    productFetcher.submit(formData, { method: "POST" });
  }, [productFetcher]);

  // ---------------------------------------------------------------------------
  // Sync workingTag with prop when modal opens
  // ---------------------------------------------------------------------------
  // Retry on auth failure (401 returns no valid data)
  useEffect(() => {
    if (productFetcher.state === "idle" && lastSubmitRef.current && retryCountRef.current < 2) {
      const data = productFetcher.data;
      if (!data && lastSubmitRef.current) {
        retryCountRef.current += 1;
        const retryData = lastSubmitRef.current;
        setTimeout(() => {
          const formData = new FormData();
          formData.set("productAction", retryData.action);
          for (const [key, val] of Object.entries(retryData)) {
            if (key !== "action" && val != null && val !== "") formData.set(key, val);
          }
          productFetcher.submit(formData, { method: "POST" });
        }, 500);
      }
    }
  }, [productFetcher.state, productFetcher.data]);

  // ---------------------------------------------------------------------------
  // Handle fetcher responses
  useEffect(() => {
    const data = productFetcher.data;
    if (!data) return;
    // Clear retry state on success
    lastSubmitRef.current = null;
    retryCountRef.current = 0;
    if (data.productAction === "searchProducts") {
      if (data.appendMode) {
        setProducts((prev) => [...prev, ...(data.products || [])]);
      } else {
        setProducts(data.products || []);
      }
      setPageInfo(data.pageInfo || { hasNextPage: false, endCursor: null });
      if (data.vendors) {
        setVendors(data.vendors);
        setProductTypes(data.productTypes || []);
        setCollections(data.collections || []);
        setFiltersLoaded(true);
      }
      setLoading(false);
    }
    if (data.productAction === "addTag" || data.productAction === "removeTag") {
      if (data.ok && data.results) {
        setProducts((prev) =>
          prev.map((p) => {
            const result = data.results.find((r) => r.id === p.id);
            return result?.ok ? { ...p, tags: result.tags } : p;
          })
        );
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        (data.results || []).forEach((r) => next.delete(r.id));
        return next;
      });
    }
  }, [productFetcher.data]);

  useEffect(() => {
    if (open) {
      setWorkingTag(currentTag || "");
      setProducts([]);
      setPageInfo({ hasNextPage: false, endCursor: null });
      setSearch("");
      setFilterVendor("");
      setFilterType("");
      setFilterCollection("");
      setFiltersLoaded(false);
      setShowConflictsOnly(false);
      setShowNoTagOnly(false);
      setShowTaggedOnly(false);
      setAddedToRule(new Set());
      setLoading(false);
      initialLoadRef.current = true;
      // Fire initial load directly
      setTimeout(() => {
        submitSearch({ loadFilters: true, search: "", vendor: "", productType: "", collectionId: "" });
      }, 0);
    } else {
      initialLoadRef.current = false;
    }
  }, [open, currentTag]);

  // ---------------------------------------------------------------------------
  // Search products
  // ---------------------------------------------------------------------------
  const submitSearch = useCallback((opts = {}) => {
    setLoading(true);
    submitProductAction({
      action: "searchProducts",
      search: opts.search ?? search,
      vendor: opts.vendor ?? filterVendor,
      productType: opts.productType ?? filterType,
      collectionId: opts.collectionId ?? filterCollection,
      first: "25",
      after: opts.after || "",
      loadFilters: opts.loadFilters ? "true" : "",
      appendMode: opts.after ? "true" : "",
    });
  }, [search, filterVendor, filterType, filterCollection, submitProductAction]);


  // ---------------------------------------------------------------------------
  // Debounced search
  // ---------------------------------------------------------------------------
  const triggerSearch = useCallback((overrides = {}) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      submitSearch(overrides);
    }, 300);
  }, [submitSearch]);

  // ---------------------------------------------------------------------------
  // Filter change handlers
  // ---------------------------------------------------------------------------
  const handleSearchChange = (val) => {
    setSearch(val);
    triggerSearch({ search: val });
  };

  const handleVendorChange = (val) => {
    setFilterVendor(val);
    triggerSearch({ vendor: val });
  };

  const handleTypeChange = (val) => {
    setFilterType(val);
    triggerSearch({ productType: val });
  };

  const handleCollectionChange = (val) => {
    setFilterCollection(val);
    triggerSearch({ collectionId: val });
  };

  const handleTagPillClick = (tag) => {
    setWorkingTag(tag);
  };

  const handleNewTag = () => {
    const tag = newTagInput.trim();
    if (!tag) return;
    setWorkingTag(tag);
    setNewTagInput("");
    setAddedToRule((prev) => new Set([...prev, tag]));
    if (onAddTagToRule) onAddTagToRule(tag);
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
    submitProductAction({
      action: "addTag",
      tag: workingTag,
      productIds: JSON.stringify([productId]),
    });
  };

  const handleRemoveTag = (productId) => {
    setPendingIds((prev) => new Set([...prev, productId]));
    submitProductAction({
      action: "removeTag",
      tag: workingTag,
      productIds: JSON.stringify([productId]),
    });
  };

  // ---------------------------------------------------------------------------
  // Escape key
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!open) return null;

  const isLoading = loading;
  const hasActiveTag = workingTag.trim().length > 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 12,
          maxWidth: 960,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
        }}
      >
        {/* ---- Header ---- */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#303030" }}>
              Browse Products
            </h2>
            {hasActiveTag && (
              <div style={{ marginTop: 4, fontSize: 13, color: "#616161" }}>
                Managing rule: <span style={{
                  display: "inline-block",
                  background: "#e0f2fe",
                  color: "#0369a1",
                  padding: "1px 8px",
                  borderRadius: 4,
                  fontWeight: 500,
                  fontSize: 12,
                }}>{ruleName || "Untitled"}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={() => { setShowTaggedOnly((prev) => !prev); setShowNoTagOnly(false); setShowConflictsOnly(false); }}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: showTaggedOnly ? "1px solid #86efac" : "1px solid #d1d5db",
                background: showTaggedOnly ? "#dcfce7" : "white",
                color: showTaggedOnly ? "#15803d" : "#303030",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#15803d" style={{ width: 24, height: 24, flexShrink: 0 }}>
                <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12a4.49 4.49 0 0 1-1.549 3.397 4.491 4.491 0 0 1-1.307 3.497 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.49 4.49 0 0 1-3.498-1.306 4.491 4.491 0 0 1-1.307-3.498A4.49 4.49 0 0 1 2.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 0 1 1.307-3.497 4.49 4.49 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
              </svg>
              Tagged
            </button>
            <button
              onClick={() => { setShowNoTagOnly((prev) => !prev); setShowConflictsOnly(false); setShowTaggedOnly(false); }}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: showNoTagOnly ? "1px solid #fecaca" : "1px solid #d1d5db",
                background: showNoTagOnly ? "#fef2f2" : "white",
                color: showNoTagOnly ? "#f87171" : "#303030",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f87171" style={{ width: 24, height: 24, flexShrink: 0 }}>
                <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clipRule="evenodd" />
              </svg>
              No tag
            </button>
            <button
              onClick={() => { setShowConflictsOnly((prev) => !prev); setShowNoTagOnly(false); setShowTaggedOnly(false); }}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: showConflictsOnly ? "1px solid #fcd34d" : "1px solid #d1d5db",
                background: showConflictsOnly ? "#fef3c7" : "white",
                color: showConflictsOnly ? "#b45309" : "#303030",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#eab308" style={{ width: 24, height: 24, flexShrink: 0 }}>
                <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
              </svg>
              Multi-tag
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 20,
                color: "#6b7280",
                padding: 4,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ---- Tag Pills ---- */}
        {(() => {
          const effectiveRuleTags = [...new Set([...currentRuleTags, ...addedToRule])];
          const otherRulesTags = allProfileTags.filter((t) => !effectiveRuleTags.includes(t));
          return (
            <div style={{
              padding: "10px 20px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
              flexShrink: 0,
            }}>
              {effectiveRuleTags.length > 0 && (
                <>
                  <span style={{ fontSize: 12, color: "#8c9196", marginRight: 4 }}>This rule:</span>
                  {effectiveRuleTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTagPillClick(t)}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 12,
                        border: "1px solid " + (t === workingTag ? "#0369a1" : "#d1d5db"),
                        background: t === workingTag ? "#e0f2fe" : "white",
                        color: t === workingTag ? "#0369a1" : "#303030",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </>
              )}
              {otherRulesTags.length > 0 && (
                <>
                  <span style={{ color: "#d1d5db", margin: "0 4px" }}>|</span>
                  <span style={{ fontSize: 12, color: "#8c9196", marginRight: 4 }}>Other rules:</span>
                  {otherRulesTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTagPillClick(t)}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 12,
                        border: "1px solid " + (t === workingTag ? "#0369a1" : "#d1d5db"),
                        background: t === workingTag ? "#e0f2fe" : "#f9fafb",
                        color: t === workingTag ? "#0369a1" : "#8c9196",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </>
              )}
              {/* Add tag input — aligned right */}
              <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                <input
                  type="text"
                  placeholder="Tag name..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleNewTag(); }}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    fontSize: 12,
                    width: 120,
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleNewTag}
                  disabled={!newTagInput.trim()}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    background: newTagInput.trim() ? "#303030" : "#f3f4f6",
                    color: newTagInput.trim() ? "white" : "#9ca3af",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: newTagInput.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Add tag
                </button>
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
          flexShrink: 0,
        }}>
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              flex: "1 1 200px",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 13,
              outline: "none",
            }}
          />
          {filtersLoaded && (
            <>
              <select
                value={filterVendor}
                onChange={(e) => handleVendorChange(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
              >
                <option value="">All vendors</option>
                {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select
                value={filterType}
                onChange={(e) => handleTypeChange(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
              >
                <option value="">All types</option>
                {productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={filterCollection}
                onChange={(e) => handleCollectionChange(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
              >
                <option value="">All collections</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </>
          )}
          <button
            onClick={handleClearFilters}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "white",
              fontSize: 13,
              cursor: "pointer",
              color: "#616161",
            }}
          >
            Clear
          </button>
        </div>

        {/* ---- Product List ---- */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0" }}>
          {!hasActiveTag && (
            <div style={{ padding: 40, textAlign: "center", color: "#8c9196", fontSize: 14 }}>
              Enter a tag in the rule first, then browse products to apply it.
            </div>
          )}

          {hasActiveTag && isLoading && products.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#8c9196", fontSize: 14 }}>
              Loading products...
            </div>
          )}

          {hasActiveTag && !isLoading && products.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#8c9196", fontSize: 14 }}>
              No products found.
            </div>
          )}

          {(() => {
            const filteredProducts = showConflictsOnly
              ? products.filter((p) => p.tags.filter((t) => allProfileTags.includes(t)).length > 1)
              : showNoTagOnly
              ? products.filter((p) => !p.tags.some((t) => allProfileTags.includes(t)))
              : showTaggedOnly
              ? products.filter((p) => p.tags.includes(workingTag))
              : products;
            // Store for footer count
            filteredCountRef.current = filteredProducts.length;
            return filteredProducts;
          })().map((product) => {
            const isTagged = product.tags.includes(workingTag);
            const isPending = pendingIds.has(product.id);

            return (
              <div
                key={product.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 20px",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "#f9fafb",
                }}>
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.imageAlt}
                      style={{ width: 40, height: 40, objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{
                      width: 40,
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#d1d5db",
                      fontSize: 16,
                    }}>
                      ☐
                    </div>
                  )}
                </div>

                {/* Product info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#303030",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {product.title}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#8c9196" }}>
                    {product.vendor}{product.productType ? ` · ${product.productType}` : ""}
                  </div>
                </div>

                {/* Multi-tag warning icon */}
                {(() => {
                  const matchingRuleTags = product.tags.filter((t) => allProfileTags.includes(t));
                  if (matchingRuleTags.length <= 1) return null;
                  return (
                    <span
                      style={{ flexShrink: 0, cursor: "default", display: "flex", alignItems: "center", marginTop: 2 }}
                      title={`Rule tags: ${matchingRuleTags.join(", ")}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#eab308" style={{ width: 24, height: 24 }}>
                        <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                      </svg>
                    </span>
                  );
                })()}

                {/* Tag status */}
                <div style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  background: isTagged ? "#dcfce7" : "#f3f4f6",
                  color: isTagged ? "#15803d" : "#8c9196",
                  flexShrink: 0,
                }}>
                  {isTagged ? "Tagged" : "Untagged"}
                </div>

                {/* Action button */}
                <button
                  onClick={() => isTagged ? handleRemoveTag(product.id) : handleAddTag(product.id)}
                  disabled={isPending}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: "1px solid " + (isTagged ? "#fecaca" : "#d1d5db"),
                    background: isTagged ? "#fef2f2" : "white",
                    color: isTagged ? "#dc2626" : "#303030",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: isPending ? "wait" : "pointer",
                    opacity: isPending ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  {isPending ? "..." : isTagged ? "Remove" : "Add tag"}
                </button>
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
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: "#8c9196" }}>
            {(showConflictsOnly || showNoTagOnly || showTaggedOnly) ? filteredCountRef.current : products.length} product{((showConflictsOnly || showNoTagOnly || showTaggedOnly) ? filteredCountRef.current : products.length) !== 1 ? "s" : ""} shown
          </span>
          {pageInfo.hasNextPage && (
            <button
              onClick={handleLoadMore}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                background: "white",
                fontSize: 13,
                cursor: "pointer",
                color: "#303030",
              }}
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
