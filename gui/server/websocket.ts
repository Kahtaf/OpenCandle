import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export interface WsClient {
  send(data: unknown): void;
  close(): void;
  onMessage(handler: (data: unknown) => void): void;
  onClose(handler: () => void): void;
}

export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsClient {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    throw new Error("Missing Sec-WebSocket-Key");
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const messageHandlers: Array<(data: unknown) => void> = [];
  const closeHandlers: Array<() => void> = [];
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = readFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.bytesRead);
      if (frame.opcode === 8) {
        socket.end();
        break;
      }
      if (frame.opcode !== 1) continue;
      try {
        const parsed = JSON.parse(frame.payload.toString("utf8"));
        for (const handler of messageHandlers) {
          handler(parsed);
        }
      } catch {
        // Ignore malformed client frames; the GUI reconnects on protocol errors.
      }
    }
  });

  socket.on("close", () => {
    for (const handler of closeHandlers) {
      handler();
    }
  });
  socket.on("error", () => {
    for (const handler of closeHandlers) {
      handler();
    }
  });

  return {
    send(data) {
      if (socket.destroyed) return;
      socket.write(writeFrame(Buffer.from(JSON.stringify(data), "utf8")));
    },
    close() {
      socket.end();
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
  };
}

function readFrame(buffer: Buffer): { opcode: number; payload: Buffer; bytesRead: number } | null {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Frame too large");
    length = Number(big);
    offset += 8;
  }

  const masked = (buffer[1] & 0x80) !== 0;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, bytesRead: offset + length };
}

function writeFrame(payload: Buffer): Buffer {
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}
