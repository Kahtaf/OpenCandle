import type { MarketStateService } from "./service.js";

export interface NotificationDeliveryOptions {
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  now?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface NotificationDeliveryResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function deliverPendingNotifications(
  service: MarketStateService,
  options: NotificationDeliveryOptions = {},
): Promise<NotificationDeliveryResult> {
  const webhookUrl = options.webhookUrl ?? process.env.OPENCANDLE_NOTIFICATION_WEBHOOK_URL ?? null;
  if (!webhookUrl) return { attempted: 0, succeeded: 0, failed: 0 };

  const now = options.now ?? new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  const attempts = service.listNotificationDeliveryAttempts();
  const deliveredWebhookIds = new Set(
    attempts
      .filter((attempt) => attempt.channel === "webhook" && attempt.status === "success")
      .map((attempt) => attempt.notificationEventId),
  );
  const lastWebhookAttemptAt = new Map<number, string>();
  for (const attempt of attempts) {
    if (attempt.channel !== "webhook" || attempt.status === "success") continue;
    const current = lastWebhookAttemptAt.get(attempt.notificationEventId);
    if (current == null || attempt.attemptedAt > current) {
      lastWebhookAttemptAt.set(attempt.notificationEventId, attempt.attemptedAt);
    }
  }

  const pendingNotifications = service
    .listNotificationEvents()
    .filter((notification) => !deliveredWebhookIds.has(notification.id))
    .sort((left, right) => {
      const leftAttempt = lastWebhookAttemptAt.get(left.id);
      const rightAttempt = lastWebhookAttemptAt.get(right.id);
      if (leftAttempt == null && rightAttempt != null) return -1;
      if (leftAttempt != null && rightAttempt == null) return 1;
      if (leftAttempt != null && rightAttempt != null && leftAttempt !== rightAttempt) {
        return leftAttempt.localeCompare(rightAttempt);
      }
      if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt);
      return left.id - right.id;
    });

  if (!isAllowedWebhookUrl(webhookUrl)) {
    const rejectedHost = webhookUrlHost(webhookUrl);
    console.warn(`Rejected notification webhook URL host: ${rejectedHost}`);
    const rejectedNotifications = pendingNotifications.slice(0, maxAttempts);
    const error = `Rejected notification webhook URL host: ${rejectedHost}`;
    for (const notification of rejectedNotifications) {
      service.recordNotificationDeliveryAttempt({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        attemptedAt: now,
        completedAt: now,
        error,
      });
    }
    const rejected = rejectedNotifications.length;
    return { attempted: rejected, succeeded: 0, failed: rejected };
  }

  for (const notification of pendingNotifications) {
    if (attempted >= maxAttempts) break;
    attempted++;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`Webhook delivery timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          id: notification.id,
          source_type: notification.sourceType,
          source_id: notification.sourceId,
          severity: notification.severity,
          title: notification.title,
          body: notification.body,
          payload: notification.payloadJson,
          status: notification.status,
          created_at: notification.createdAt,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      clearTimeout(timeout);
      service.recordNotificationDeliveryAttempt({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "success",
        attemptedAt: now,
        completedAt: now,
        response: { status: response.status },
      });
      succeeded++;
    } catch (error) {
      clearTimeout(timeout);
      const message = controller.signal.aborted
        ? `Webhook delivery timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      service.recordNotificationDeliveryAttempt({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        attemptedAt: now,
        completedAt: now,
        error: message,
      });
      failed++;
    }
  }

  return { attempted, succeeded, failed };
}

function isAllowedWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname;
  if (host === "169.254.169.254" || host.startsWith("169.254.")) return false;
  return true;
}

function webhookUrlHost(raw: string): string {
  try {
    return new URL(raw).hostname || "(empty)";
  } catch {
    return "(invalid URL)";
  }
}
