#!/usr/bin/env NODE_NO_WARNINGS=1 npx tsx

import { SerialPort } from "serialport";
import * as readline from "readline";
import * as child_process from "child_process";
import WebSocket from "ws";

const sleep = async (ms: number) => await new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { ws: string; serial: string } {
  const args = process.argv.slice(2);
  let ws = "";
  let serial = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ws" && args[i + 1]) {
      ws = args[++i];
    } else if (args[i] === "--serial" && args[i + 1]) {
      serial = args[++i];
    }
  }

  if (!ws || !serial) {
    console.error(
      "Usage: modem.ts --ws <websocket-url> --serial <serial-device>",
    );
    console.error(
      "  Example: modem.ts --ws wss://example.com/ws --serial /dev/cu.usbmodem246802461",
    );
    process.exit(1);
  }

  return { ws, serial };
}

// ---------------------------------------------------------------------------
// Parity helpers  (7E1 <-> 8N1 conversion)
// Used only for data transfer after CONNECT, not during AT command phase.
// ---------------------------------------------------------------------------

/** Compute even parity bit for the 7 LSBs of a byte. */
function evenParity(b: number): number {
  b &= 0x7f;
  b ^= b >> 4;
  b ^= b >> 2;
  b ^= b >> 1;
  return b & 1;
}

/** Convert a 7-bit data byte to an 8N1 byte with even-parity bit set in bit 7. */
function to7E1(b: number): number {
  const data = b & 0x7f;
  const parity = evenParity(data);
  return data | (parity << 7);
}

/** Strip the parity bit from a byte received over 7E1 serial. */
function from7E1(b: number): number {
  return b & 0x7f;
}

// ---------------------------------------------------------------------------
// Serial port helpers
// ---------------------------------------------------------------------------

function writeByte(port: SerialPort, byte: number): Promise<void> {
  return new Promise((resolve: any, reject) => {
    port.write(Buffer.from([byte]), (err) => {
      if (err) reject(err);
      else port.drain(resolve);
    });
  });
}

async function writeSerial(
  port: SerialPort,
  data: Buffer | Uint8Array,
): Promise<void> {
  for (const byte of data) {
    await writeByte(port, byte);
    await new Promise((r) => setTimeout(r, 4));
  }
}

/**
 * Send an AT command (plain ASCII, no parity encoding) and wait for OK.
 * The modem echoes the command back — we skip lines that match the sent
 * command and look for OK or ERROR.
 */
function sendCommand(
  port: SerialPort,
  command: string,
  buffer: { data: string },
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    console.log(`> ${command}`);

    try {
      // AT commands sent as plain ASCII (8N1, no parity encoding)
      await writeSerial(port, Buffer.from(command + "\r", "ascii"));
    } catch (err) {
      return reject(err);
    }

    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for OK after: ${command}`));
    }, 10_000);

    // Poll the accumulated buffer for OK / ERROR
    // AT modems use \r\n line endings but split on any combination of \r/\n
    const interval = setInterval(() => {
      const lines = buffer.data.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        if (trimmed === command) {
          // Echo of our own command — skip, don't print
          continue;
        }
        if (trimmed === "OK") {
          console.log(`< OK`);
          buffer.data = "";
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (
          trimmed === "ERROR" ||
          trimmed.startsWith("+CME ERROR") ||
          trimmed.startsWith("+CMS ERROR")
        ) {
          buffer.data = "";
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new Error(`Modem returned ERROR for command: ${command}`));
          return;
        }
        // Any other non-empty response line (e.g. intermediate result)
        console.log(`< ${trimmed}`);
      }
      // Trim fully-processed lines; keep only content after the last separator
      const lastSep = Math.max(
        buffer.data.lastIndexOf("\r"),
        buffer.data.lastIndexOf("\n"),
      );
      if (lastSep >= 0) {
        buffer.data = buffer.data.slice(lastSep + 1);
      }
    }, 50);
  });
}

/** Wait for a response line that starts with a given prefix (e.g. "CONNECT"). */
function waitForResponse(
  _port: SerialPort,
  prefix: string,
  buffer: { data: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${prefix}" from modem`));
    }, 60_000);

    const interval = setInterval(() => {
      const lines = buffer.data.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        console.log(`< ${trimmed}`);
        if (trimmed.startsWith(prefix)) {
          buffer.data = "";
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(trimmed);
          return;
        }
        if (trimmed === "NO CARRIER" || trimmed === "ERROR") {
          buffer.data = "";
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new Error(`Modem returned: ${trimmed}`));
          return;
        }
      }
      const lastSep = Math.max(
        buffer.data.lastIndexOf("\r"),
        buffer.data.lastIndexOf("\n"),
      );
      if (lastSep >= 0) {
        buffer.data = buffer.data.slice(lastSep + 1);
      }
    }, 50);
  });
}


// ---------------------------------------------------------------------------
// CLI stdin input parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CLI input line into bytes to send to the modem.
 * Supports embedded hex sequences like "0x20" or "0x0d" anywhere in the string.
 * Example: "0x20celso" -> [0x20, 'c', 'e', 'l', 's', 'o']
 * Example: "hello 0x0d world" -> [...'hello ', 0x0d, ...' world']
 */
function parseCliInput(line: string): number[] {
  const bytes: number[] = [];
  // Match either a hex token (0x followed by hex digits) or a run of non-hex chars
  const tokenRe = /0x([0-9a-fA-F]{1,2})|([\s\S]+?(?=0x|$))/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(line)) !== null) {
    if (match[1] !== undefined) {
      // Hex token — exactly one byte (1-2 hex digits)
      bytes.push(parseInt(match[1], 16));
    } else if (match[2]) {
      // Plain text — encode as ASCII bytes
      for (let i = 0; i < match[2].length; i++) {
        bytes.push(match[2].charCodeAt(i) & 0xff);
      }
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { ws: wsUrl, serial: serialPath } = parseArgs();

  // ── 1. Connect to WebSocket server ───────────────────────────────────────
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => {
      console.log("WebSocket connected.");
      resolve();
    });
    ws.once("error", (err: Error) => {
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    });
  });

  // ── 2. Open serial port ──────────────────────────────────────────────────
  console.log(`Opening serial port: ${serialPath} @ 9600 8N1`);
  const port = new SerialPort({
    path: serialPath,
    baudRate: 1200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    rtscts: true,
    autoOpen: false,
  });

  await new Promise<void>((resolve, reject) => {
    port.open((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  console.log("Serial port open.");

  // Clear CLOCAL so the OS actually tracks the DCD pin.
  // Without this, ioctl(TIOCMGET) always reports DCD=high regardless of carrier.
  // serialport v13 does not expose this flag, so we use stty directly.
  await new Promise<void>((resolve, reject) => {
    child_process.exec(`stty -f ${serialPath} -clocal`, (err) => {
      if (err) {
        // Non-fatal: log and continue; AT&C1 alone may still be enough.
        console.warn(`stty -clocal failed (${err.message}), DCD polling may not work.`);
      }
      resolve();
    });
  });

  // Shared receive buffer for AT command / response parsing
  // During AT phase the modem speaks plain ASCII 8N1 — no parity stripping.
  const rxBuf = { data: "" };

  port.on("data", (chunk: Buffer) => {
    rxBuf.data += chunk.toString("ascii");
  });

  // ── 3. Modem initialisation sequence ─────────────────────────────────────
  const initCommands = [
    "ATZ",
    "AT+ES=0,0,1", // Error Control and Synchronous Mode Selection +ES=[<orig_rqst>[,<orig_fbk>[,<ans_fbk>]]] All we care is ans_fbk (modem is operating as the answerer) 1 = Error control disabled, use Normal Mode.
    "AT+MS=V23C,0", // V23C: Selects the V.23 protocol. 0: Disables automode (forces the modem to use only V.23). 1200, 1200: Sets the minimum and maximum rx speeds to 1200
    "AT+ES=0", // Disable Error Correction
    "AT&K0", // Disable Flow Control. (Crucial for binary, as hardware flow control can pause the stream unexpectedly).
    "AT+IFC=0,0", // Disable DTE-Modem flow control
    "ATB0", // CCITT mode
    "ATE1", // Echo
    "ATS2=255", // (Setting S2 to a value greater than 127 effectively disables the escape character)
    "AT&C1", // DCD follows carrier: modem deasserts DCD pin when carrier is lost (required for port.get() dcd polling to work)
  ];

  for (const cmd of initCommands) {
    await sendCommand(port, cmd, rxBuf);
    await sleep(200);
  }

  // ── 4. Answer and wait for CONNECT ───────────────────────────────────────
  console.log("> ATA");
  await writeSerial(port, Buffer.from("ATA\r", "ascii"));

  const connectResponse = await waitForResponse(port, "CONNECT", rxBuf);
  console.log(`Modem connected: ${connectResponse}`);

  // ── 5. Switch port data handler to relay mode ─────────────────────────────
  // After CONNECT the line is 7E1 — strip parity bit from incoming bytes.
  port.removeAllListeners("data");

  let connected = true;

  // ── DCD (carrier detect) polling ─────────────────────────────────────────
  // The OS serial port stays open even when the remote modem hangs up, so no
  // "close" event fires. Instead, poll the DCD modem status line every 500ms
  // and treat a low carrier as a disconnect.
  const dcdPoller = setInterval(() => {
    if (!connected) {
      clearInterval(dcdPoller);
      return;
    }
    port.get((err, status) => {
      if (!connected) return;
      if (err || !status?.dcd) {
        connected = false;
        clearInterval(dcdPoller);
        console.error("Modem carrier lost (DCD low). Notifying server and exiting.");
        ws.send(JSON.stringify({ type: "disconnect" }), () => {
          process.exit(1);
        });
      }
    });
  }, 500);

  // Buffer to detect the Hayes "NO CARRIER" disconnect string.
  // Characters that form a current prefix of NO_CARRIER are held in
  // `noCarrierPending` and not forwarded upstream until we know they
  // are not part of the sequence.
  const NO_CARRIER = "\r\nNO CARRIER\r\n";
  let noCarrierPending = "";

  const flushPending = () => {
    for (const ch of noCarrierPending)
      ws.send(JSON.stringify({ type: "key", key: ch }));
    noCarrierPending = "";
  };

  port.on("data", (chunk: Buffer) => {
    if (!connected) return;
    for (const byte of chunk) {
      const data = from7E1(byte);
      const ch = String.fromCharCode(data);
      const candidate = noCarrierPending + ch;

      if (NO_CARRIER === candidate) {
        // Full match — discard buffered chars, disconnect.
        noCarrierPending = "";
        connected = false;
        clearInterval(dcdPoller);
        console.error("Modem sent NO CARRIER. Notifying server and exiting.");
        ws.send(JSON.stringify({ type: "disconnect" }), () => {
          process.exit(1);
        });
        return;
      } else if (NO_CARRIER.startsWith(candidate)) {
        // Partial prefix — hold, don't forward yet.
        noCarrierPending = candidate;
      } else {
        // Not a prefix — flush any held chars, then send this one.
        flushPending();
        ws.send(JSON.stringify({ type: "key", key: ch }));
      }
    }
  });

  port.on("close", () => {
    console.error("close() fired");
    if (!connected) return;
    connected = false;
    console.error("Serial port closed unexpectedly. Exiting.");
    process.exit(1);
  });

  port.on("error", (err: Error) => {
    if (!connected) return;
    connected = false;
    console.error(`Serial port error: ${err.message}. Exiting.`);
    process.exit(1);
  });

  console.log("Waiting 3 seconds");
  await sleep(3000);

  // ── 6. Notify WS server ───────────────────────────────────────────────────
  ws.send(JSON.stringify({ type: "init_viewdata" }));
  console.log("Sent viewdata_init to WebSocket server. Waiting for frames…");


  // ── 8. Forward stdin lines → modem ──────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (line: string) => {
    if (!connected) return;
    const bytes = parseCliInput(line);
    if (bytes.length === 0) return;
    const hex = bytes.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ");
    console.log(`[stdin] sending ${bytes.length} byte(s): ${hex}`);
    const encoded = Buffer.from(bytes.map(to7E1));
    try {
      await writeSerial(port, encoded);
    } catch (err) {
      if (!connected) return;
      connected = false;
      console.error(
        `Failed to write stdin data to serial port: ${(err as Error).message}. Exiting.`,
      );
      process.exit(1);
    }
  });

  // ── 7. Forward WS frames → modem ─────────────────────────────────────────
  // Serial write queue — ensures frames are sent one at a time.
  let writeQueue: Promise<void> = Promise.resolve();

  ws.on("message", (data: WebSocket.RawData) => {
    if (!connected) return;
    let msg: { type: string; data?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.error("Received invalid JSON from WebSocket, ignoring.");
      return;
    }

    if (msg.type === "frame" && msg.data) {
      const raw = Buffer.from(msg.data, "base64");
      // Convert each byte to 7E1 before sending to modem
      const encoded = Buffer.from([...raw].map(to7E1));
      writeQueue = writeQueue.then(() =>
        writeSerial(port, encoded).catch((err) => {
          if (!connected) return;
          connected = false;
          console.error(
            `Failed to write to serial port: ${(err as Error).message}. Exiting.`,
          );
          process.exit(1);
        }),
      );
    }
  });

  ws.on("close", () => {
    if (!connected) return;
    connected = false;
    console.error("WebSocket disconnected. Exiting.");
    process.exit(1);
  });

  ws.on("error", (err: Error) => {
    if (!connected) return;
    connected = false;
    console.error(`WebSocket error: ${err.message}. Exiting.`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
