import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { MarketStateService } from "../../market-state/service.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import type { StatefulToolOptions } from "./stateful-tool-options.js";

const params = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("acknowledge")], {
    description: "One of: list, acknowledge. Use acknowledge with id to mark a notification read.",
  }),
  id: Type.Optional(Type.Number({ description: "Notification id for acknowledge." })),
});

export function createNotificationsTool(options: StatefulToolOptions): AgentTool<typeof params> {
  return {
    name: "manage_notifications",
    label: "Notifications",
    description:
      "List durable OpenCandle notifications or acknowledge a notification by id. Use this for alert and report notification history.",
    parameters: params,
    async execute(_toolCallId, args) {
      const db = options.stateDatabaseFactory();
      const service = new MarketStateService(db);
      try {
        if (args.action === "acknowledge") {
          if (args.id == null) throw new Error("id is required for acknowledge.");
          const notification = service.acknowledgeNotificationEvent(args.id);
          return {
            content: [{ type: "text", text: `Acknowledged notification #${notification.id}.` }],
            details: notification,
          };
        }

        const notifications = service.listNotificationEvents();
        if (notifications.length === 0) {
          return { content: [{ type: "text", text: "No notifications yet." }], details: [] };
        }
        const lines = ["**Notifications**", ""];
        for (const notification of notifications.slice(0, 20)) {
          lines.push(`  #${notification.id} [${notification.status}] ${notification.title}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }], details: notifications };
      } finally {
        if (options.closeDatabaseAfterExecute !== false) db.close();
      }
    },
  };
}

export const notificationsTool = createNotificationsTool({
  stateDatabaseFactory: initDefaultDatabase,
});
