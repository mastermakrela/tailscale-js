import type { DistributedOmit, RouterTypes, ServeFunctionOptions, ServeOptions, Server } from "bun";

type TailscaleServeFunctionOptions<T, R extends { [K in keyof R]: RouterTypes.RouteValue<K & string> }> = DistributedOmit<
	ServeFunctionOptions<T, R>,
	"websocket" | "unix" | "reusePort" | "ipv6Only" | "tls"
> & {
	tailscale?: TailscaleConfig;
};

export interface TailscaleConfig {
	control_url?: string;
	auth_key?: string;
	ephemeral?: boolean;
	dir?: string;
	hostname?: string;
	port?: string;
}

const WORKER_URL = import.meta.url.includes("$bunfs")
	? "./tailscale_worker.ts"
	: new URL("./tailscale_worker.ts", import.meta.url);

let server: Server | undefined;
let ts_worker: Worker;

function parse_options<T, R extends { [K in keyof R]: RouterTypes.RouteValue<K & string> }>(
	_options: TailscaleServeFunctionOptions<T, R>
) {
	for (const disallowed of ["unix", "reusePort", "ipv6Only", "tls"]) {
		if (disallowed in _options) {
			console.warn(
				`[tailscale-js][${new Date().toUTCString()}] Option ${disallowed} is not supported when using Tailscale. it will be ignored`
			);
			// @ts-expect-error - we are deleting keys that shouldn't be there, so yeah TS is confused
			delete _options[disallowed];
		}
	}

	// after the check above and based on our custom type we assume that this type must be correct
	let options = _options as ServeOptions & {
		routes: {
			[K in keyof R]: RouterTypes.RouteValueWithWebSocketUpgrade<Extract<K, string>>;
		};
		tailscale?: TailscaleConfig;
	};

	const tailscale_config = options.tailscale ?? {};
	tailscale_config.ephemeral ??= true;
	tailscale_config.hostname ??= options.hostname ?? "tailscale-js";
	if (options.port) {
		tailscale_config.port ??= `${options.port}`;
		if (!tailscale_config.port.startsWith(":")) {
			tailscale_config.port = `:${tailscale_config.port}`;
		}
	}

	delete options.tailscale;
	delete options.hostname;
	delete options.port;

	const id = options.id ?? "tailscale-js";
	const unix = `/tmp/tailscale-js-${id}.sock`;

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
				writer.write(data.buffer);
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

function create_worker(
	{
		server_config,
		unix,
	}: {
		unix: string;
		tailscale_config: TailscaleConfig;
		server_config: TailscaleServeFunctionOptions<any, any>;
	},
	resolve: (value?: Server | PromiseLike<Server> | undefined) => void
) {
	if (typeof Bun === "undefined") {
		console.warn(`[tailscale-js][${new Date().toUTCString()}]
Because every runtime (BUn, Deno, Node) has its own FFI and I had to start somewhere,
this library is currently only compatible with Bun (https://bun.sh).

If you want to use this library in Deno or Node, consider opening a PR or issue on GitHub:
https://github.com/mastermakrela/tailscale-js/pulls
		`);
		process.exit(1);
	}

	if (ts_worker) {
		console.error(`[tailscale-js][${new Date().toUTCString()}] Only one worker can be created at a time`);
		return;
	}

	// Fallback for npm package
	try {
		ts_worker = new Worker(new URL("./tailscale_worker", import.meta.url));
	} catch (secondError) {
		// Final fallback attempt
		ts_worker = new Worker("./node_modules/@mastermakrela/tailscale-js/dist/tailscale_worker.js");
	}

	ts_worker.onerror = (error) => {
		console.error(`[tailscale-js][${new Date().toUTCString()}] Error in worker: ${error.message ?? error}`);
	};

	ts_worker.onmessage = async (event) => {
		if (!event.data.type) return;

		switch (event.data.type) {
			case "ready":
				server = Bun.serve({
					...server_config,
					unix,
					// TODO: figure out how to make fetch optional if not provided from the user
					async fetch(request, server) {
						const resp = await server_config.fetch?.bind(this)(request, server);
						resp?.headers.set("server", "tailscale-js-bun");
						resp?.headers.set("X-Powered-By", "Tailscale in Bun");
						return resp ?? new Response(null, { status: 404 });
					},
				});
				console.info(`[tailscale-js][${new Date().toUTCString()}] Local server started`);
				console.info(
					`[tailscale-js][${new Date().toUTCString()}] To stop the server use CTRL + \\ (Backslash) (CTRL + C will not work - seems to be a ffi bug)`
				);
				console.info();
				resolve(server);
				break;

			case "connection":
				if (!server) return;

				const conn = event.data.conn as number;
				await handle_connection(unix, conn);
				break;
			case "exit":
				console.error(`[tailscale-js][${new Date().toUTCString()}] Tailscale worker exited with code ${event.data.code}`);
				process.exit(event.data.code);
				break;
			default:
				console.error(`[tailscale-js][${new Date().toUTCString()}] Unknown message type: ${event.data.type}`);
				break;
		}
	};
}

// MARK: Exported functions

/**
 * Drop-in replacement for `Bun.serve` that exposes the server in your tailnet.
 *
 * @template T Type parameter for WebSocket data type
 * @param options - Server configuration options
 * @returns Server instance (has to be awaited, because starting the worker is async)
 */
function serve<T, R extends { [K in keyof R]: RouterTypes.RouteValue<K & string> }>(
	options: TailscaleServeFunctionOptions<T, R> & {
		/**
		 * @deprecated Use `routes` instead in new code. This will continue to work for a while though.
		 */
		static?: R;
	}
): Promise<Server> {
	if (server) {
		console.error(`[tailscale-js][${new Date().toUTCString()}] Only one server can be started at a time`);
		throw new Error("Only one server can be started at a time");
	}

	const configs = parse_options<T, R>(options);

	const { resolve, promise } = Promise.withResolvers<Server>();

	create_worker(configs, resolve);

	ts_worker.postMessage({ type: "listen", config: configs.tailscale_config });

	return promise;
}

/**
 * Similar to {@link serve}, but exposes the server to the internet with HTTPS using a Tailscale funnel.
 *
 * @param options - Server configuration options
 * @throws {Error} If a server is already running
 * @throws {Error} If an invalid port is specified (only 443, 8443, and 10000 are allowed for funnel)
 * @returns Server instance (has to be awaited, because starting the worker is async)
 */
function funnel<T, R extends { [K in keyof R]: RouterTypes.RouteValue<K & string> }>(
	options: TailscaleServeFunctionOptions<T, R> & {
		/**
		 * @deprecated Use `routes` instead in new code. This will continue to work for a while though.
		 */
		static?: R;
	}
): Promise<Server> {
	if (server) {
		console.error(`[tailscale-js][${new Date().toUTCString()}] Only one server can be started at a time`);
		throw new Error("Only one server can be started at a time");
	}

	const configs = parse_options<T, R>(options);

	if (configs.tailscale_config.port && !["443", "8443", "10000"].includes(configs.tailscale_config.port)) {
		throw new Error("Invalid port for funnel");
	}

	const { resolve, promise } = Promise.withResolvers<Server>();

	create_worker(configs, resolve);

	ts_worker.postMessage({ type: "funnel", config: configs.tailscale_config });

	return promise;
}

/**
 * Represents the Tailscale client with available operations.
 *
 * @property serve - Starts server in the tailnet.
 * @property funnel - Starts server available to the internet through Tailscale Funnel.
 */
const Tailscale: {
	serve: typeof serve;
	funnel: typeof funnel;
} = {
	serve,
	funnel,
};

export default Tailscale;

export { funnel, serve };
