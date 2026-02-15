import { authenticate } from "../shopify.server";
import db from "../db.server";
import { safeLogError } from "../utils/validation";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  // Idempotency check
  if (webhookId) {
    const existing = await db.webhookEvent.findUnique({
      where: { id: webhookId },
    });
    if (existing) {
      console.log(`Webhook ${webhookId} already processed, skipping`);
      return new Response(null, { status: 200 });
    }
  }

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Only delete sessions on uninstall
    if (topic === "app/uninstalled" && session) {
      await db.session.deleteMany({ where: { shop } });
    }

    // Record webhook as processed
    if (webhookId) {
      await db.webhookEvent.create({
        data: { id: webhookId, topic, shop },
      });
    }
  } catch (error) {
    safeLogError(`Webhook ${topic} failed for ${shop}`, error);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(null, { status: 200 });
};
