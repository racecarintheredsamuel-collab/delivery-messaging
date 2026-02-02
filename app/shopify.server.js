import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Validate required environment variables at startup
const requiredEnvVars = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
];

const missingVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}. ` +
    "Check your .env file or deployment configuration."
  );
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES.split(","),
  appUrl: process.env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,

webhooks: {
  APP_UNINSTALLED: {
    deliveryMethod: "http",
    callbackUrl: "/webhooks",
  },

  APP_SCOPES_UPDATE: {
    deliveryMethod: "http",
    callbackUrl: "/webhooks",
  },
},


hooks: {
  afterAuth: async ({ session }) => {
    console.log("afterAuth: starting webhook registration for", session.shop);

    try {
      const result = await registerWebhooks({ session });
      console.log("afterAuth: registerWebhooks result =", JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("afterAuth: registerWebhooks ERROR =", err);
    }

    console.log("afterAuth: finished webhook registration attempt for", session.shop);
  },
},
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
