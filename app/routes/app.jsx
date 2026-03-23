import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { CHECK_ACTIVE_SUBSCRIPTION } from "../graphql/queries";
import { useEffect } from "react";

// App handle from Partner Dashboard (locked after creation)
const APP_HANDLE = "delivery-info-block";

// ============================================================================
// LOADER — authenticates and checks subscription status
// ============================================================================

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const shop = session?.shop || "";
  const storeHandle = shop.replace(".myshopify.com", "");

  // --- Subscription check (Shopify Managed Pricing) ---
  // Direct GraphQL query — no billing config needed, works with managed pricing.
  // Default fail-closed: if the check fails, block access.
  let hasActiveSubscription = false;
  try {
    const res = await admin.graphql(CHECK_ACTIVE_SUBSCRIPTION);
    const json = await res.json();
    const subscriptions = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    hasActiveSubscription = subscriptions.length > 0;
    console.log("[BILLING] Shop:", shop, "Active:", hasActiveSubscription, "Count:", subscriptions.length);
  } catch (error) {
    console.error("[BILLING] Failed to check subscription:", error);
    // Fail-closed: hasActiveSubscription stays false
  }

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hasActiveSubscription,
    planUrl: `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`,
  };
};

// ============================================================================
// SUBSCRIPTION GATE — shown when no active plan
// ============================================================================

function SubscriptionGate({ planUrl }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "80vh",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        textAlign: "center",
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: "48px 32px",
      }}>
        {/* App icon */}
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "#111827",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.25 18.75a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 1 3 0ZM15.75 18.75a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 1 3 0Z" />
            <path d="M2.25 2.25h1.5l1.17 5.85a2.25 2.25 0 0 0 2.23 1.9h7.45a2.25 2.25 0 0 0 2.23-1.9L18 4.5H5.25" />
          </svg>
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: "#111827",
          margin: "0 0 8px 0",
        }}>
          Delivery Messaging
        </h1>

        <p style={{
          fontSize: 15,
          color: "#6b7280",
          lineHeight: 1.6,
          margin: "0 0 24px 0",
        }}>
          Show customers real-time delivery estimates, countdown timers, and ETA timelines on your product pages.
        </p>

        {/* Pricing card */}
        <div style={{
          background: "#f9fafb",
          borderRadius: 10,
          padding: 16,
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>
            $7.99<span style={{ fontSize: 15, fontWeight: 400, color: "#6b7280" }}>/month</span>
          </div>
          <div style={{ fontSize: 14, color: "#059669", fontWeight: 500, marginTop: 4 }}>
            14-day free trial
          </div>
        </div>

        {/* CTA — links to Shopify-hosted plan selection page */}
        <a
          href={planUrl}
          target="_top"
          style={{
            display: "inline-block",
            padding: "12px 32px",
            background: "#111827",
            color: "white",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          Start free trial
        </a>

        <p style={{
          fontSize: 13,
          color: "#9ca3af",
          margin: "16px 0 0 0",
        }}>
          Managed by Shopify · Cancel anytime
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// APP LAYOUT
// ============================================================================

export default function App() {
  const { apiKey, hasActiveSubscription, planUrl } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/messages">Messages Editor</s-link>
        <s-link href="/app/free-delivery">Free Delivery</s-link>
        <s-link href="/app/icons">Icons</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      {hasActiveSubscription ? (
        <Outlet />
      ) : (
        <SubscriptionGate planUrl={planUrl} />
      )}
    </AppProvider>
  );
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// Auto-retry on empty auth failures (e.g. HMR reload before session token is ready)
export function ErrorBoundary() {
  const error = useRouteError();
  const isEmptyAuthError = (error.constructor.name === 'ErrorResponse' || error.constructor.name === 'ErrorResponseImpl') && !error.data;

  useEffect(() => {
    if (isEmptyAuthError) {
      const timer = setTimeout(() => {
        window.location.reload();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isEmptyAuthError]);

  if (isEmptyAuthError) {
    return null;
  }

  return boundary.error(error);
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
