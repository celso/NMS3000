import { DurableObject } from "cloudflare:workers";
import { entrypointScreen } from "./script";
import { serverSend } from "./videotex";

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

export class WebSocketServer extends DurableObject<Env> {
  private sessionState: Array<{
    server: any;
    cf: any;
    page: any;
    type: string;
    cursor: [row: number, col: number];
  }>;
  currentlyConnectedWebSockets;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessionState = [];
    this.currentlyConnectedWebSockets = 0;
  }

  async render(session: any) {
    const page = session.page;
    await page.render(session);

    await serverSend(session, "{clear()}");

    const initialBuffer = await getScreenBuffer(
      this.env,
      page.constructor.screen,
    );
    await serverSend(session, initialBuffer);

    if (page.codes.length) {
      await serverSend(session, page.codes);
    }

    if (Object.keys(page.navigation).length) {
      const colors = [
        "AlphaRed",
        "AlphaGreen",
        "AlphaYellow",
        "AlphaBlue",
        "AlphaMagenta",
        "AlphaCyan",
        "AlphaWhite",
      ];
      const keys = Object.keys(page.navigation);
      let menu = "{go(0,0)}";
      for (let k = 0; k < keys.length; k++) {
        const target = page.navigation[keys[k]];
        const targetName =
          typeof target == "string" ? target : target.constructor.name;
        menu += `{${colors[k % colors.length]}}${keys[k]}: ${targetName}`;
      }
      await serverSend(session, menu);
    }
  }

  async fetch(request: Request) {
    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Calling `accept()` connects the WebSocket to this Durable Object
    server.accept();
    this.currentlyConnectedWebSockets += 1;
    this.sessionState[this.currentlyConnectedWebSockets] = {
      server,
      cf: request.cf,
      page: entrypointScreen,
      type: "rows",
      cursor: [0, 0],
    };

    const getSession = () => {
      return this.sessionState[this.currentlyConnectedWebSockets];
    };

    const setPageOptions = (options: any) => {
      this.sessionState[this.currentlyConnectedWebSockets] = {
        ...this.sessionState[this.currentlyConnectedWebSockets],
        ...options,
      };
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
            this.render(getSession());
            break;
          case "init_viewdata":
            setPageOptions({ type: "viewdata" });
            this.render(getSession());
            break;
          case "key":
            const session = getSession();
            const next = await session.page.onKey(String(data.key), session);
            if (next) {
              setPageOptions({ page: next });
              this.render(getSession());
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
