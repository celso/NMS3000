import { DurableObject } from "cloudflare:workers";
import { decodeViewdataRaw } from "./videotex";

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

export class WebSocketServer extends DurableObject<Env> {
  private screenBuffer: any;
  currentlyConnectedWebSockets;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.currentlyConnectedWebSockets = 0;
  }

  async fetch(request: Request) {
    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Calling `accept()` connects the WebSocket to this Durable Object
    server.accept();
    this.currentlyConnectedWebSockets += 1;

    // Upon receiving a message from the client, the server replies with the same message,
    // and the total number of connections with the "[Durable Object]: " prefix
    server.addEventListener("message", async (event) => {
      try {
        console.log(event.data);
        const r = await this.env.ASSETS.fetch(
          new Request("https://assets.local/image2.raw"),
        );
        this.screenBuffer = {
          rows: decodeViewdataRaw(await r.bytes()),
        };
        server.send(
          JSON.stringify({
            type: "frame",
            rows: this.screenBuffer.rows,
          }),
        );
      } catch (e) {
        console.log(e);
      }
    });

    // If the client closes the connection, the runtime will close the connection too.
    server.addEventListener("close", (cls) => {
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
