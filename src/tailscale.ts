import type { ServeOptions, Server } from "./bun.d.ts";

export interface TailscaleConfig {
	control_url?: string;
	auth_key?: string;
	ephemeral?: boolean;
	dir?: string;
	hostname?: string;
	port?: string;
}

export interface TailscaleServer extends Omit<ServeOptions, "reusePort" | "unix"> {
	tailscale?: TailscaleConfig;
}

const WORKER_URL = import.meta.url.includes("$bunfs")
	? "./tailscale_worker.ts"
	: new URL("./tailscale_worker.ts", import.meta.url);

let server: Server | undefined;
let ts_worker: Worker;

function parse_options(options: TailscaleServer) {
	const tailscale_config = options.tailscale ?? {};
	tailscale_config.ephemeral ??= true;
	tailscale_config.hostname ??= options.hostname ?? "tailscalejs";
	if (options.port) {
		tailscale_config.port ??= `${options.port}`;
		if (!tailscale_config.port.startsWith(":")) {
			tailscale_config.port = `:${tailscale_config.port}`;
		}
	}

	delete options.tailscale;
	delete options.hostname;
	delete options.port;

	const id = options.id ?? "tailscalejs";
	const unix = `/tmp/tailscalejs-${id}.sock`;

	return {
		unix,
		tailscale_config,
		server_config: options,
	};
}

/**
 * This function accepts tailscale connection and "pipes" it to the local server.
 *
 * @param unix the unix socket path to the local server
 * @param conn the file descriptor of the connection
 */
async function handle_connection(unix: string, conn: number) {
	const conn_socket = Bun.file(conn);
	const stream = conn_socket.stream();
	const writer = conn_socket.writer();

	const socket = await Bun.connect({
		unix,
		socket: {
			data(_, data) {
				writer.write(data);
			},
			close(_) {
				writer.end();
			},
			end(_) {
				writer.end();
			},
		},
	});

	// @ts-expect-error - for some reason Bun doesn't type this correctly
	for await (const chunk of stream) {
		socket.write(chunk);
	}
}

function create_worker({
	server_config,
	unix,
}: {
	unix: string;
	tailscale_config: TailscaleConfig;
	server_config: TailscaleServer;
}) {
	if (ts_worker) {
		console.error("Only one worker can be created at a time");
		return;
	}

	ts_worker = new Worker(WORKER_URL);

	ts_worker.onerror = (error) => {
		console.error(`[${new Date().toISOString()}][tailscale] error in worker:`, error.message ?? error);
	};

	ts_worker.onmessage = async (event) => {
		if (!event.data.type) return;

		switch (event.data.type) {
			case "ready":
				server = Bun.serve({
					...server_config,
					unix,
					async fetch(request, server) {
						const resp = await server_config.fetch.bind(this)(request, server);
						resp.headers.set("server", "tailscalejs-bun");
						resp.headers.set("X-Powered-By", "Tailscale in Bun");
						return resp;
					},
				});
				console.log(`[${new Date().toISOString()}][tailscale] Local server started`);
				break;

			case "connection":
				if (!server) return;

				const conn = event.data.conn as number;
				await handle_connection(unix, conn);
				break;
			case "exit":
				console.error("Tailscale worker exited with code", event.data.code);
				process.exit(event.data.code);
				break;
			default:
				console.error("Unknown message type:", event.data.type);
				break;
		}
	};
}

// MARK: Exported functions

/**
 * Drop in replacement for Bun.serve that exposes the server in your tailnet.
 *
 * @param options - Server configuration options
 * @returns
 */
function serve(options: TailscaleServer) {
	if (server) {
		console.error("Only one server can be started at a time");
		return;
	}

	const configs = parse_options(options);

	create_worker(configs);

	ts_worker.postMessage({ type: "listen", config: configs.tailscale_config });
}

/**
 * Similar to {@link serve}, but exposes the server to the internet with HTTPS using a Tailscale funnel.
 *
 * @param options - Server configuration options
 * @throws {Error} If a server is already running
 * @throws {Error} If an invalid port is specified (only 443, 8443, and 10000 are allowed for funnel)
 */
function funnel(options: TailscaleServer) {
	if (server) {
		console.error("Only one server can be started at a time");
		return;
	}

	const configs = parse_options(options);

	if (configs.tailscale_config.port && !["443", "8443", "10000"].includes(configs.tailscale_config.port)) {
		console.error("Invalid port for funnel");
		return;
	}

	create_worker(configs);

	ts_worker.postMessage({ type: "funnel", config: configs.tailscale_config });
}

/**
 * Represents the Tailscale client with available operations.
 *
 * @property serve - Starts server in the tailnet.
 * @property funnel - Starts server available to to the internet through Tailscale Funnel.
 */
const Tailscale: {
	serve: typeof serve;
	funnel: typeof funnel;
} = {
	serve,
	funnel,
};

export default Tailscale;

export { serve, funnel };
