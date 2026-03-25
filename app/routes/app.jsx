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

// Prevent subscription check revalidation on child route POST actions
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }) {
  if (formMethod === "POST") return false;
  return defaultShouldRevalidate;
}

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
  const font = "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, sans-serif";
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "80vh",
      padding: 24,
      fontFamily: font,
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        textAlign: "center",
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "48px 32px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}>
        {/* App icon */}
        <img
          src="/images/icon/delivery_messaging_v4.png"
          alt="Delivery Messaging"
          style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            marginBottom: 16,
          }}
        />

        <h1 style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#303030",
          margin: "0 0 8px 0",
          fontFamily: font,
        }}>
          Delivery Messaging
        </h1>

        <p style={{
          fontSize: 13,
          color: "#616161",
          lineHeight: 1.6,
          margin: "0 0 24px 0",
          fontFamily: font,
        }}>
          Show customers real-time delivery estimates, countdown timers, and ETA timelines on your product pages.
        </p>

        {/* Pricing card */}
        <div style={{
          background: "#f7f7f7",
          borderRadius: 8,
          padding: "14px 16px",
          marginBottom: 24,
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ fontSize: 26, fontWeight: 650, color: "#303030", fontFamily: font }}>
            $7.99<span style={{ fontSize: 14, fontWeight: 400, color: "#616161" }}>/month</span>
          </div>
          <div style={{ fontSize: 13, color: "#008060", fontWeight: 500, marginTop: 4, fontFamily: font }}>
            14-day free trial
          </div>
        </div>

        {/* CTA — links to Shopify-hosted plan selection page */}
        <a
          href={planUrl}
          target="_top"
          style={{
            display: "inline-block",
            padding: "10px 24px",
            background: "#303030",
            color: "white",
            borderRadius: 8,
            fontWeight: 500,
            fontSize: 13,
            textDecoration: "none",
            fontFamily: font,
          }}
        >
          Start free trial
        </a>

        <p style={{
          fontSize: 12,
          color: "#8c9196",
          margin: "16px 0 0 0",
          fontFamily: font,
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
