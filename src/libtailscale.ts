/**
 * @module libtailscale
 * This module is a wrapper around the libtailscale shared library.
 *
 * It wraps the pointer and other ffi stuff to make interacting more js-like.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync } from "node:fs";

// MARK: - Types

type Result<T = undefined> = { success: true; value: T } | { success: false; error: string };

const FFI_tailscale = FFIType.int;
export type tailscale_t = typeof FFI_tailscale;

const FFI_tailscale_listener = FFIType.int;
export type tailscale_listener_t = typeof FFI_tailscale_listener;

const FFI_tailscale_conn = FFIType.int;
export type tailscale_conn_t = typeof FFI_tailscale_conn;

// MARK: - Shared library

const libtailscale_so = () => {
	if (Bun.env.LIBTAILSCALE_SO_PATH) return Bun.env.LIBTAILSCALE_SO_PATH;

	const candidates = [
		"libtailscale-darwin-arm64.dylib",
		"libtailscale-darwin-amd64.dylib",
		"libtailscale-linux-amd64.so",
		"libtailscale-linux-arm64.so",
	];

	for (const candidate of candidates) {
		if (existsSync(`./${candidate}`)) {
			return candidate;
		}
	}

	throw new Error("Could not find libtailscale");
};

let path = "./libtailscale";
try {
	path = libtailscale_so();
} catch (e) {
	console.error(`
⚠️  ERROR: Could not find libtailscale shared library ⚠️

Expected filenames in current directory:
  • libtailscale-darwin-amd64.dylib   (macOS Intel)
  • libtailscale-darwin-arm64.dylib   (macOS Apple Silicon)
  • libtailscale-linux-amd64.so       (Linux x86_64)
  • libtailscale-linux-arm64.so       (Linux ARM64)

Resolution options:
  1. Download pre-built library:
     bun x tailscale-js get-libtailscale

  2. Build it yourself:
     https://github.com/mastermakrela/libtailscale?tab=readme-ov-file#building

  3. If you have the file with a different name or location, set the environment variable:
     LIBTAILSCALE_SO_PATH=./path/to/your/libtailscale.so bun your-script.ts
`);

	process.exit(1);
}

const { symbols: lib } = dlopen(path, {
	tailscale_new: {
		args: [],
		returns: FFI_tailscale,
	},
	tailscale_start: {
		args: [FFI_tailscale],
		returns: FFIType.int,
	},
	tailscale_up: {
		args: [FFI_tailscale],
		returns: FFIType.int,
	},
	tailscale_close: {
		args: [FFI_tailscale],
		returns: FFIType.int,
	},
	tailscale_set_dir: {
		args: [FFI_tailscale, FFIType.cstring],
		returns: FFIType.int,
	},
	tailscale_set_hostname: {
		args: [FFI_tailscale, FFIType.cstring],
		returns: FFIType.int,
	},
	tailscale_set_authkey: {
		args: [FFI_tailscale, FFIType.cstring],
		returns: FFIType.int,
	},
	tailscale_set_control_url: {
		args: [FFI_tailscale, FFIType.cstring],
		returns: FFIType.int,
	},
	tailscale_set_ephemeral: {
		args: [FFI_tailscale, FFIType.int],
		returns: FFIType.int,
	},
	tailscale_set_logfd: {
		args: [FFI_tailscale, FFIType.int],
		returns: FFIType.int,
	},
	tailscale_getips: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.u64],
		returns: FFIType.int,
	},
	tailscale_dial: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.cstring, FFIType.pointer],
		returns: FFIType.int,
	},
	tailscale_listen: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.cstring, FFIType.pointer],
		returns: FFIType.int,
	},
	tailscale_listen_funnel: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.cstring, FFIType.int, FFIType.pointer],
		returns: FFIType.int,
	},
	tailscale_getremoteaddr: {
		args: [FFI_tailscale_listener, FFI_tailscale_conn, FFIType.cstring, FFIType.u64],
		returns: FFIType.int,
	},
	tailscale_accept: {
		args: [FFI_tailscale_listener, FFIType.pointer],
		returns: FFIType.int,
	},
	tailscale_accept_nonblocking: {
		args: [FFI_tailscale_listener, FFIType.pointer],
		returns: FFIType.int,
	},
	tailscale_loopback: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.u64, FFIType.cstring, FFIType.cstring],
		returns: FFIType.int,
	},
	tailscale_errmsg: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.u64],
		returns: FFIType.int,
	},
	tailscale_cert_domains: {
		args: [FFI_tailscale, FFIType.cstring, FFIType.u64],
		returns: FFIType.int,
	},
});

// MARK: - Helpers

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// TODO: get those from the shared library
export const EBADF = 9;
export const ERANGE = 34;
export const EAGAIN = 35;
function get_error(sd: tailscale_t): string {
	const buf = new Uint8Array(256);

	let ret: number;
	if ((ret = lib.tailscale_errmsg(sd, buf, buf.length))) {
		switch (ret) {
			case EBADF:
				return "EBADF";
			case ERANGE:
				return "ERANGE";
			case EAGAIN:
				return "EAGAIN";
			default:
				return "unknown error";
		}
	}

	return decoder.decode(buf);
}

// MARK: - libtailscale

/** Creates a tailscale server object. No network connection is initialized until tailscale_start is called. */
export function tailscale_new(): tailscale_t {
	return lib.tailscale_new();
}

/**
 * Connects the server to the tailnet.
 * Calling this function is optional as it will be called by the first use of tailscale_listen or tailscale_dial on a server.
 * See also: tailscale_up.
 * @returns Result tuple containing null on success, or error message on failure
 */
export function tailscale_start(sd: tailscale_t): Result {
	if (lib.tailscale_start(sd)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

/**
 * Connects the server to the tailnet and waits for it to be usable.
 * To cancel an in-progress call to tailscale_up, use tailscale_close.
 */
export function tailscale_up(sd: tailscale_t): Result {
	if (lib.tailscale_up(sd)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

export type tailscale_network = "tcp" | "udp";

/**
 * Connects to the address on the tailnet.
 *
 * @param sd Tailscale server handle
 * @param options Configuration options
 * @param options.network Protocol to use ("tcp" or "udp"). Defaults to "tcp".
 * @param options.addr String of an IP address or domain name to connect to.
 * @returns
 */
export function tailscale_dial(
	sd: tailscale_t,
	{
		network = "tcp",
		addr,
	}: {
		network?: tailscale_network;
		addr: string;
	}
): Result<tailscale_conn_t> {
	const network_str = encoder.encode(network + "\0");
	const addr_str = encoder.encode(addr + "\0");

	const conn_ptr = new Int32Array(1);
	if (lib.tailscale_dial(sd, conn_ptr)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: conn_ptr[0] };
}

/**
 * Listens for connections on the tailnet.
 * Equivalent to listen(2).
 * Will start the server if it has not been started yet.
 *
 * @param sd Tailscale server handle
 * @param options Configuration options
 * @param options.network Protocol to use ("tcp" or "udp"). Defaults to "tcp".
 * @param options.addr IP address or domain name to listen on. Defaults to ":1999".
 */
export function tailscale_listen(
	sd: tailscale_t,
	{
		network = "tcp",
		addr = ":1999",
	}: {
		network?: tailscale_network;
		addr?: string;
	} = {}
): Result<tailscale_listener_t> {
	const network_str = encoder.encode(network + "\0");
	const addr_str = encoder.encode(addr + "\0");

	const ln_ptr = new Int32Array(1);
	if (lib.tailscale_listen(sd, network_str, addr_str, ln_ptr)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: ln_ptr[0] };
}

/**
 * Announces node on the public internet using Tailscale Funnel.
 *
 * It also by default listens on your local tailnet, so connections can come from either inside or outside your network.
 * To restrict connections to be just from the internet, use the FunnelOnly option.
 *
 * Currently (2024-12-13), Funnel only supports TCP on ports 443, 8443, and 10000.
 * The supported host name is limited to that configured for the tsnet.Server.
 *
 * @param sd Tailscale server handle
 * @param options - The options for the listener.
 * @param options.network - The network type (default is "tcp").
 * @param options.addr - The address to listen on (default is ":443"; only supported values are ":443", ":8443", and ":10000").
 * @returns A Result object containing either the listener or an error message.
 *
 */
export function tailscale_listen_funnel(
	sd: tailscale_t,
	{
		network = "tcp",
		addr = ":443",
		funnel_only = false,
	}: {
		network?: tailscale_network;
		addr?: string;
		funnel_only?: boolean;
	} = {}
): Result<tailscale_listener_t> {
	if (![":443", ":8443", ":10000"].includes(addr)) {
		return {
			success: false,
			error: `Currently, only :443, :8443, and :10000 are supported.
This is a Tailscale limitation, see: https://tailscale.com/kb/1223/funnel#requirements-and-limitations
If this changes in the future, we will update this error message.`,
		};
	}

	const network_str = encoder.encode(network + "\0");
	const addr_str = encoder.encode(addr + "\0");

	const ln_ptr = new Int32Array(1);
	if (lib.tailscale_listen_funnel(sd, network_str, addr_str, funnel_only ? 1 : 0, ln_ptr)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: ln_ptr[0] };
}

/**
 * Returns the remote address for an incoming connection for a particular listener.
 *
 * @param ln A Tailscale listener handle
 * @param conn A Tailscale connection handle
 * @returns The address (eitehr ip4 or ip6)
 */
export function tailscale_getremoteaddr(ln: tailscale_listener_t, conn: tailscale_conn_t): Result<string> {
	const addr_ptr = new Uint8Array(256);
	if (lib.tailscale_getremoteaddr(ln, conn, addr_ptr, addr_ptr.length)) {
		const err = get_error(ln);
		return { success: false, error: err };
	}
	return { success: true, value: decoder.decode(addr_ptr) };
}

/**
 * Shuts down the server.
 * @returns Result tuple containing null on success, or error message on failure
 */
export function tailscale_close(sd: tailscale_t): Result {
	if (lib.tailscale_close(sd)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

/**
 * Accepts a new connection from a Tailscale listener.
 * Similar to accept(2), blocks the calling thread until a new connection is available.
 *
 * @param ln A Tailscale listener handle obtained from {@link tailscale_listen} or {@link tailscale_listen_funnel}.
 * @returns A Result containing either:
 *  - On success: a connection handle as {@link tailscale_conn_t}
 *  - On failure: an error message
 */
export function tailscale_accept(ln: tailscale_listener_t): Result<tailscale_conn_t> {
	const conn = new Int32Array(1);
	const conn_ptr = ptr(conn);

	if (lib.tailscale_accept(ln, conn_ptr)) {
		const err = get_error(ln);
		return { success: false, error: err };
	}
	return { success: true, value: conn[0] };
}

/**
 * Accepts a connection on a tailscale_listener without blocking.
 * Returns immediately if there is no connection to accept.
 * @param ln Listener handle
 * @returns Result tuple containing connection handle on success, or error message on failure
 */
export function tailscale_accept_nonblocking(ln: tailscale_listener_t): Result<tailscale_conn_t> {
	const conn = new Int32Array(1);
	const conn_ptr = ptr(conn);

	if (lib.tailscale_accept_nonblocking(ln, conn_ptr)) {
		const err = get_error(ln);
		return { success: false, error: err };
	}
	return { success: true, value: conn[0] };
}

export function tailscale_loopback() {
	throw new Error("Not implemented");
}

// MARK: - libtailscale configuration

/**
 * Sets whether the tailscale instance should be ephemeral.
 * Must be configured before any explicit or implicit call to tailscale_start.
 * @param sd Tailscale server handle
 * @param ephemeral Whether to make the instance ephemeral
 */
export function tailscale_set_ephemeral(sd: tailscale_t, ephemeral: boolean): Result {
	if (lib.tailscale_set_ephemeral(sd, ephemeral ? 1 : 0)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

export function tailscale_set_hostname(sd: tailscale_t, hostname: string): Result {
	const hostname_str = encoder.encode(hostname + "\0");
	if (lib.tailscale_set_hostname(sd, hostname_str)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

export function tailscale_set_control_url(sd: tailscale_t, control_url: string): Result {
	const control_url_str = encoder.encode(control_url + "\0");
	if (lib.tailscale_set_control_url(sd, control_url_str)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

export function tailscale_set_authkey(sd: tailscale_t, auth_key: string): Result {
	const auth_key_str = encoder.encode(auth_key + "\0");
	if (lib.tailscale_set_authkey(sd, auth_key_str)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

export function tailscale_set_dir(sd: tailscale_t, dir: string): Result {
	const dir_str = encoder.encode(dir + "\0");
	if (lib.tailscale_set_dir(sd, dir_str)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

/**
 * Instructs the instance to write logs to the specified file descriptor.
 * Must be configured before any explicit or implicit call to tailscale_start.
 *
 * _Disclaimer_: haven't tested it in bun yet, so it might not work. fds in js are weird.
 *
 * @param sd - Tailscale server handle
 * @param logfd - File descriptor for logging. Use -1 to discard all logging.
 */
export function tailscale_set_logfd(sd: tailscale_t, logfd: number): Result {
	if (lib.tailscale_set_logfd(sd, logfd)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}
	return { success: true, value: undefined };
}

// MARK: - libtailscale infos

/**
 * Returns the IP addresses of the the Tailscale server as a list.
 *
 * @param sd Tailscale server handle
 * @returns A list of IP addresses inside the tailnet.
 */
export function tailscale_getips(sd: tailscale_t): Result<string[]> {
	// i know the size is an overkill, but it works, so ¯\_(ツ)_/¯
	const ips_ptr = new Uint8Array(1024);

	if (lib.tailscale_getips(sd, ips_ptr, ips_ptr.length)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}

	const ips = decoder.decode(ips_ptr).split("\0")[0].trim().split(",");

	return { success: true, value: [...ips.values()] };
}

/**
 * Returns the list of domains for which the server can provide TLS certificates.
 * These are also the DNS names for the Server.
 *
 * This is especially useful for {@link tailscale_listen_funnel}.
 *
 * @param sd Tailscale server handle
 */
export function tailscale_cert_domains(sd: tailscale_t): Result<{ domains: string[] }> {
	const domains_ptr = new Uint8Array(256);

	if (lib.tailscale_cert_domains(sd, domains_ptr, domains_ptr.length)) {
		const err = get_error(sd);
		return { success: false, error: err };
	}

	const domains = decoder.decode(domains_ptr).split("\0").filter(Boolean);

	return { success: true, value: { domains } };
}
