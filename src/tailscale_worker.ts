declare var self: Worker;

import { close } from "node:fs";
import {
	tailscale_accept_nonblocking,
	tailscale_cert_domains,
	tailscale_close,
	tailscale_getips,
	tailscale_listen,
	tailscale_listen_funnel,
	tailscale_new,
	tailscale_set_authkey,
	tailscale_set_control_url,
	tailscale_set_dir,
	tailscale_set_ephemeral,
	tailscale_set_hostname,
	tailscale_up,
	type tailscale_listener_t,
	type tailscale_t,
} from "./libtailscale";
import type { TailscaleConfig } from "./tailscale";

let ts: tailscale_t | null = null;
let listener: tailscale_listener_t | null = null;

function cleanup(code = 0): never {
	console.info(`[tailscale-worker][${new Date().toUTCString()}] Start exiting worker with code ${code}`);
	if (listener) close(listener);
	if (ts) tailscale_close(ts);
	postMessage({ type: "exit", code });
	console.info(`[tailscale-worker][${new Date().toUTCString()}] Exiting worker with code ${code}`);
	process.exit(code);
}

process.on("exit", () => {
	cleanup(0);
});

onmessage = (event) => {
	if (!event.data.type) return;

	switch (event.data.type) {
		case "listen":
			console.info(`[tailscale-worker][${new Date().toUTCString()}] Init Tailscale listen`);
			init_ts_instance(event.data.config);
			listen({ port: event.data.config.port, hostname: event.data.config.hostname });
			break;
		case "funnel":
			console.info(`[tailscale-worker][${new Date().toUTCString()}] Init Tailscale funnel`);
			init_ts_instance(event.data.config);
			funnel({ port: event.data.config.port, hostname: event.data.config.hostname });
			break;
		case "stop":
			console.info(`[tailscale-worker][${new Date().toUTCString()}] Stop Tailscale`);
			cleanup(0);
			break;
		default:
			console.error(`[tailscale-worker][${new Date().toUTCString()}] Unknown message type: ${event.data.type}`);
			break;
	}
};

function init_ts_instance(config: TailscaleConfig) {
	if (ts) {
		console.info(`[tailscale-worker][${new Date().toUTCString()}] Tailscale already initialized`);
		return;
	}

	ts = tailscale_new();

	if (config.control_url) {
		const control_url_result = tailscale_set_control_url(ts, config.control_url);
		if (!control_url_result.success) {
			console.error(
				`[tailscale-worker][${new Date().toUTCString()}] tailscale_set_control_url failed: ${control_url_result.error}`
			);
			cleanup(3);
		}
	}

	if (config.auth_key) {
		const auth_key_result = tailscale_set_authkey(ts, config.auth_key);
		if (!auth_key_result.success) {
			console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_set_authkey failed: ${auth_key_result.error}`);
			cleanup(3);
		}
	}

	if (config.dir) {
		const dir_result = tailscale_set_dir(ts, config.dir);
		if (!dir_result.success) {
			console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_set_dir failed: ${dir_result.error}`);
			cleanup(3);
		}
	}

	const hostname_result = tailscale_set_hostname(ts, config.hostname ?? "tailscale-js");
	if (!hostname_result.success) {
		console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_set_hostname failed: ${hostname_result.error}`);
		cleanup(3);
	}

	const ephemeral_result = tailscale_set_ephemeral(ts, config.ephemeral ?? true);
	if (!ephemeral_result.success) {
		console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_set_ephemeral failed: ${ephemeral_result.error}`);
		cleanup(3);
	}

	const up_result = tailscale_up(ts);
	if (!up_result.success) {
		console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_up failed: ${up_result.error}`);
		cleanup(5);
	}
}

function listen({ port, hostname }: { port?: string; hostname?: string }) {
	if (!ts) {
		console.debug(`[tailscale-worker][${new Date().toUTCString()}] No ts instance`);
		return;
	}

	if (listener) {
		console.info(`[tailscale-worker][${new Date().toUTCString()}] Already listening`);
		return;
	}

	const listen_result = tailscale_listen(ts, { addr: port });
	if (!listen_result.success) {
		console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_listen failed: ${listen_result.error}`);
		cleanup(6);
	}
	listener = listen_result.value;

	const ips = tailscale_getips(ts);
	const _port = port ?? ":1999";

	const tailnet_name = Bun.env.LIBTAILSCALE_TAILNET_NAME ?? "<your-tailnet-name>";

	console.info(`[tailscale-worker][${new Date().toUTCString()}] Tailscale serve is up and running! Waiting for connections...`);
	console.info(`[tailscale-worker][${new Date().toUTCString()}]
You can access your server at
\t- http://${hostname}.${tailnet_name}.ts.net${_port}`);
	if (ips.success) {
		ips.value.forEach((ip) => {
			const formattedIp = ip.includes(":") ? `[${ip}]` : ip;
			console.info(`\t- http://${formattedIp}${_port}`);
		});
	}

	handle_connections(listener);
}

function funnel({ port, hostname }: { port?: string; hostname?: string }) {
	if (!ts) {
		console.debug(`[tailscale-worker][${new Date().toUTCString()}] No ts instance`);
		return;
	}

	if (listener) {
		console.info(`[tailscale-worker][${new Date().toUTCString()}] Already listening`);
		return;
	}

	const listen_result = tailscale_listen_funnel(ts, { addr: port });
	if (!listen_result.success) {
		console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_listen failed: ${listen_result.error}`);
		cleanup(6);
	}
	listener = listen_result.value;

	const domains = tailscale_cert_domains(ts!);
	const _port = port && port !== ":443" ? port : "";

	console.info(
		`[tailscale-worker][${new Date().toUTCString()}] Tailscale funnel is up and running! Waiting for connections...`
	);
	console.info(`[tailscale-worker][${new Date().toUTCString()}]
You can access your server at`);
	if (domains.success) {
		for (const domain of domains.value.domains) {
			console.info(`\t- https://${domain}${_port}`);
		}
	} else {
		const tailnet_name = Bun.env.LIBTAILSCALE_TAILNET_NAME ?? "<your-tailnet-name>";
		console.info(`\t- https://${hostname}.${tailnet_name}.ts.net${_port}`);
	}

	handle_connections(listener);
}

async function handle_connections(ln: tailscale_listener_t) {
	postMessage({ type: "ready" });

	while (true) {
		const accept_result = tailscale_accept_nonblocking(ln);
		if (!accept_result.success) {
			// TODO: figure out why EBADF is returned instead of EAGAIN
			// if (accept_result.error !== "EAGAIN") {
			// 	console.error(`[tailscale-worker][${new Date().toUTCString()}] tailscale_accept_nonblocking failed: ${accept_result.error}`);
			// }
			continue;
		} else {
			const conn = accept_result.value;
			console.info(`[tailscale-worker][${new Date().toUTCString()}] accepted connection ${conn}`);

			postMessage({ type: "connection", conn });
		}

		await Bun.sleep(1000);
	}
}
