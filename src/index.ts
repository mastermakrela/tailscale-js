import Tailscale from "./tailscale";

console.log("Hello via Bun!");

Tailscale.serve;

Tailscale.funnel({
	id: "tailscale-serve",
	development: true,
	// port: 6969,
	// hostname: "tail-scale-inator",
	static: {
		"/ping": new Response("pong"),
	},
	fetch(req) {
		// console.log(`🦔 ~ file: index.ts:14 ~ fetch ~ req:`, req.headers.toJSON());
		const url = new URL(req.url);

		if (url.pathname === "/error") {
			throw new Error("you asked for this");
		}

		if (url.pathname === "/time") {
			const now = new Date();
			return new Response(`
${now.toISOString()}
${now.getTime()}
${now.toLocaleDateString("de-DE")}
`);
		}

		return new Response(`Tailscale in Bun!\nyou have requested ${req.url}`);
	},
	// tailscale: {
	// 	hostname: "importanter-name", // this has precedence over the hostname
	// 	port: ":4242", // default value
	// },
});
