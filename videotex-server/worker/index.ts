import { DurableObject } from "cloudflare:workers";
import { decodeViewdataRaw } from "./videotex";
import { CELLS_PER_ROW, TOTAL_ROWS } from "~lib/characterCodes";
import { characterCodes, noEscCodes } from "../lib/characterCodes";

const defaultNavigation = {
  type: "top",
  pages: {
    "1": "home",
    "2": "weather",
    "3": "bart",
  },
};

const sessionScript: any = {
  home: {
    screen: "data/cloudflare.raw",
    navigation: defaultNavigation,
  },
  weather: {
    screen: "data/weather.raw",
    navigation: defaultNavigation,
  },
  bart: {
    screen: "data/bart.raw",
    navigation: defaultNavigation,
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      console.log("Websocket called");
      // Validate WebSocket upgrade request
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected WebSocket upgrade", {
          status: 426,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // Route to a single Durable Object instance by name.
      // Use a fixed name here for simplicity; in production you might
      // derive the name from a room ID, user ID, etc.
      console.log("Routing to DO");
      const stub = env.WEBSOCKET_SERVER.getByName("default");
      return stub.fetch(request);
    }

    // For all other requests, return 404.
    // Static assets are served automatically by the assets configuration
    // (run_worker_first only routes /ws through the Worker).
    console.log("Worker 404");
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

const getScreenBuffer = async (env: Env, image: string) => {
  const r = await env.ASSETS.fetch(
    new Request(`https://assets.local/${image}`),
  );
  return await r.bytes();
};

const getScreenRows = async (env: Env, image: string) => {
  const r = await env.ASSETS.fetch(
    new Request(`https://assets.local/${image}`),
  );
  return await r.json();
};

const serverSend = async (server: any, session: any, payload: any) => {
  console.log("\n\nsession:");
  console.log(session);
  console.log("payload:");
  console.log(payload);
  if (session.type == "rows") {
    // rows data go one at a time
    const rows = decodeViewdataRaw(payload.data);
    console.log("rows:");
    console.log(rows);
    rows.forEach((row: any, i: any) => {
      server.send(
        JSON.stringify({
          type: "row",
          row: session.cursor[0] + i,
          data: row,
        }),
      );
    });
  }
  if (session.type == "viewdata") {
    payload.data = btoa(String.fromCharCode(...payload.data));
    // viewdata is streamed, send frame in one take
    server.send(JSON.stringify(payload));
  }
};

const incrementCursor = (session: any, n: number) => {
  const totalCols = session.cursor[1] + n;
  const newCol = totalCols % CELLS_PER_ROW;
  const newRow =
    (session.cursor[0] + Math.floor(totalCols / CELLS_PER_ROW)) % TOTAL_ROWS;
  session.cursor = [newRow, newCol];
};

export class WebSocketServer extends DurableObject<Env> {
  private sessionState: Array<{
    page: string;
    type: string;
    cursor: [row: number, col: number];
  }>;
  currentlyConnectedWebSockets;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessionState = [];
    this.currentlyConnectedWebSockets = 0;
  }

  /**
   * Parse a template string containing { code } blocks and plain text.
   *
   * Syntax: '{ codeName }text{ codeName(arg1, arg2) }more text'
   *
   * Supported code forms:
   *   { AlphaRed }          — emit the named control byte
   *   { go(col, row) }      — position cursor: EscHome + row×EscLf + col×space
   *
   * All named codes correspond to keys of characterCodes from lib/characterCodes.ts.
   *
   * Returns a viewdata-encoded Uint8Array (control bytes ESC-encoded as 1B XX).
   */
  parseCodes(session: any, codes: string): Uint8Array {
    // Tokenise into code blocks { ... } and intervening text runs.
    // Each match has either group 1 (code block content) or group 2 (text).
    const TOKEN_RE = /\{([^}]*)\}|([^{]+)/g;

    const chunks: Uint8Array[] = [];
    const pushText = (s: string) =>
      chunks.push(Uint8Array.from(s, (c) => c.charCodeAt(0)));

    for (const match of codes.matchAll(TOKEN_RE)) {
      const codeBlock = match[1];
      const text = match[2];

      if (text !== undefined) {
        // Plain text — append as-is (printable chars ≥ 0x20 pass straight through).
        pushText(text);
        incrementCursor(session, text.length);
        continue;
      }

      // Code block: trim whitespace and check for function-call form.
      const token = codeBlock.trim();
      const parenIdx = token.indexOf("(");

      if (parenIdx === -1) {
        // Simple named code: look up in characterCodes.
        const bytes = characterCodes[token as keyof typeof characterCodes];
        if (bytes !== undefined) {
          chunks.push(bytes);
          incrementCursor(session, 1);
        } else {
          console.warn(`parseCodes: unknown code "${token}"`);
        }
      } else {
        // Function-call form: name(arg1, arg2, ...)
        const name = token.slice(0, parenIdx).trim();
        const argsStr = token
          .slice(parenIdx + 1, token.lastIndexOf(")"))
          .trim();
        const args = argsStr.split(",").map((a) => parseInt(a.trim(), 10));

        switch (name) {
          case "clear":
              chunks.push(noEscCodes.EscClear);
              chunks.push(noEscCodes.EscHome);
            break;
          case "go":
            const row = args[0] ?? 0;
            const col = args[1] ?? 0;
            if (session.type == "viewdata") {
              // Jump to (0,0) then advance by row line-feeds and col spaces.
              chunks.push(noEscCodes.EscHome);
              for (let r = 0; r < row; r++) chunks.push(noEscCodes.EscLf);
            }
            pushText(" ".repeat(col));
            session.cursor = [row, col];
            break;
          default:
            console.warn(`parseCodes: unknown function "${name}"`);
        }
      }
    }

    const totalLen = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  async render(session: any, server: any, page: any) {
    const initialBuffer = await getScreenBuffer(this.env, page.screen);

    serverSend(server, session, {
      type: "frame",
      data: initialBuffer,
    });

    serverSend(server, session, {
      type: "frame",
      data: this.parseCodes(
        session,
        "{ clear() }{ go(0,10) }{ Flash }{ AlphaRed }celso martinho",
      ),
    });
  }

  async fetch(request: Request) {
    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Calling `accept()` connects the WebSocket to this Durable Object
    server.accept();
    this.currentlyConnectedWebSockets += 1;
    this.sessionState[this.currentlyConnectedWebSockets] = {
      page: "home",
      type: "rows",
      cursor: [0, 0],
    };

    const getSession = () => {
      return this.sessionState[this.currentlyConnectedWebSockets];
    };

    const getPage = () => {
      return sessionScript[
        this.sessionState[this.currentlyConnectedWebSockets].page
      ];
    };

    const setPageOptions = (options: any) => {
      this.sessionState[this.currentlyConnectedWebSockets] = {
        ...this.sessionState[this.currentlyConnectedWebSockets],
        ...options,
      };
      return getPage();
    };

    // Upon receiving a message from the client, the server replies with the same message,
    // and the total number of connections with the "[Durable Object]: " prefix
    server.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(data);
        switch (data.type) {
          case "init":
            setPageOptions({ type: "rows" });
            this.render(getSession(), server, getPage());
            break;
          case "init_viewdata":
            setPageOptions({ type: "viewdata" });
            this.render(getSession(), server, getPage());
            break;
          case "key":
            const page = getPage();
            const availableKeys = Object.keys(page.navigation.pages);
            if (availableKeys.includes(String(data.key))) {
              console.log(availableKeys);
              console.log(data.key);
              setPageOptions({ page: page.navigation.pages[data.key] });
              this.render(getSession(), server, getPage());
            }
            break;
        }
      } catch (e) {
        console.log(e);
      }
    });

    // If the client closes the connection, the runtime will close the connection too.
    server.addEventListener("close", (cls) => {
      console.log("closing websocket");
      this.currentlyConnectedWebSockets -= 1;
      server.close(cls.code, "Durable Object is closing WebSocket");
    });

    server.addEventListener("error", (cls) => {
      console.log(cls);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
