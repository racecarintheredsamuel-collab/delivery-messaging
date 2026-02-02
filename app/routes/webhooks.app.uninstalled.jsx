import { authenticate } from "../shopify.server";
import db from "../db.server";
import { safeLogError } from "../utils/validation";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  // Idempotency check - skip if we've already processed this webhook
  if (webhookId) {
    const existing = await db.webhookEvent.findUnique({
      where: { id: webhookId },
    });
    if (existing) {
      console.log(`Webhook ${webhookId} already processed, skipping`);
      return new Response();
    }
  }

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }

    // Record webhook as processed for idempotency
    if (webhookId) {
      await db.webhookEvent.create({
        data: {
          id: webhookId,
          topic,
          shop,
        },
      });
    }
  } catch (error) {
    safeLogError(`Webhook ${topic} failed for ${shop}`, error);
    // Return 500 so Shopify will retry
    return new Response("Internal error", { status: 500 });
  }

  return new Response();
};
