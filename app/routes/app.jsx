import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { useEffect } from "react";

// App handle from Partner Dashboard (locked after creation)
const APP_HANDLE = "delivery-info-block";

// ============================================================================
// LOADER — authenticates and checks billing status
// Follows: https://shopify.dev/docs/apps/launch/billing/redirect-plan-selection-page
// ============================================================================

export const loader = async ({ request }) => {
  // Authenticate and get billing + redirect utilities
  const { billing, redirect, session } = await authenticate.admin(request);

  // Check whether the store has an active subscription
  const billingResult = await billing.check({
    plans: [MONTHLY_PLAN],
  });
  const { hasActivePayment, appSubscriptions } = billingResult;
  console.log("[BILLING] Shop:", session.shop, "hasActivePayment:", hasActivePayment, "subscriptions:", JSON.stringify(appSubscriptions));

  // Extract the store handle from the shop domain
  const shop = session.shop;
  const storeHandle = shop.replace(".myshopify.com", "");

  // If there's no active subscription, redirect to the plan selection page
  if (!hasActivePayment) {
    return redirect(
      `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`,
      { target: "_top" }
    );
  }

  // Otherwise, continue loading the app as normal
  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

// ============================================================================
// APP LAYOUT
// ============================================================================

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/messages">Messages Editor</s-link>
        <s-link href="/app/free-delivery">Free Delivery</s-link>
        <s-link href="/app/icons">Icons</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <Outlet />
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
