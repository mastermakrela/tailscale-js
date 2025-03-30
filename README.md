# tailscale-js

> [!IMPORTANT]  
> Because every runtime has its own FFI, this library is currently only compatible with [Bun](https://bun.sh).

## Quick start:

1. Install the js library

```zsh
bun add tailscale-js
```

2. Get the `libtailscale` shared library

```zsh
bun x tailscale-js get-libtailscale
```

Or if you don't like downloading pre-built binaries from the internet, you can [build it yourself](https://github.com/mastermakrela/libtailscale?tab=readme-ov-file#building).

_Currently, the prebuilt libraries are available for macOS and linux, but they might not work on all platforms - in that case please file an issue or PR._

3. Use the library where you have used `Bun.serve` before:

```typescript
import Tailscale from "tailscale-js";

await Bun.$`echo LIBTAILSCALE_TAILNET_NAME=pango-lin > .env`;

Tailscale.serve({
	routes: {
		"/time": new Response(new Date().toISOString()),
	},
	fetch(req) {
		return new Response("Bun through Tailscale!");
	},
});
```

Setting the `LIBTAILSCALE_TAILNET_NAME` env variable to your tailnet name
will give you nicer terminal message with a clickable link.

If you want to expose the server to the internet using a [funnel](https://tailscale.com/kb/1223/funnel),
you can use `Tailscale.funnel` instead of `Tailscale.serve`.

## Usage

### Standard

See [Quick start](#quick-start) section.

### Bun's Single-file executable

As mentioned in the [docs](https://bun.sh/docs/bundler/executables#worker),
when bundling an application that uses a worker one has to include it in the CLI arguments:

```zsh
bun build --compile index.ts ./node_modules/tailscale-js/dist/tailscale_worker.js
```

> [!NOTE]  
> Currently the `libtailscale` shared library is not bundled inside the executable.
> So you have to put it next to the executable.

### Docker

If you want to deploy Tailscale in a container (e.g., on fly.io),
you can use `libtailscale`s docker container.

```Dockerfile
FROM ghcr.io/mastermakrela/tailscale-js:latest

COPY . .

RUN bun install

CMD ["bun","index.ts"]
```

The container contains prebuilt `libtailscale` shared library
and already sets the `LIBTAILSCALE_TAILNET_NAME` env variable.

## Docs

### What is supported?

Because we are just wrapping Bun's http server,
_almost_ all features from Bun's `serve` function are supported.

The biggest missing feature are websockets, which are AFAIK not currently supported by Tailscale Funnel.

The TLS options are also gone, because Tailscale Funnel provides own domain and certificates.

### Configuration

Additionally, to the Bun's `serve` options, you can pass a `tailscale` option to both `serve` and `funnel` functions.
It is defined as follows:

```ts
type TailscaleConfig = {
	control_url?: string;
	auth_key?: string;
	ephemeral?: boolean;
	dir?: string;
	hostname?: string;
	port?: string;
};
```

They correspond to the options in [`tsnet`](https://pkg.go.dev/tailscale.com/tsnet#FunnelOption), which is the base for [`libtailscale`](https://github.com/mastermakrela/libtailscale).

If both `TailscaleConfig` and `Bun.serve` options are provided, the `TailscaleConfig` options will be used
(e.g., port or hostname).

### Environment variables

| Name                        | Description                                 |
| --------------------------- | ------------------------------------------- |
| `LIBTAILSCALE_SO_PATH`      | Path to the shared library                  |
| `LIBTAILSCALE_TAILNET_NAME` | Tailnet name to use in the terminal message |

### Known Issues

1. <kbd>CTRL</kbd> + <kbd>C</kbd> doesn't work

   It seems to be a ffi bug, but I'm not sure. For now, use <kbd>CTRL</kbd> + <kbd>\</kbd> instead.

2. Bun types can get out of sync

   The `Bun.serve` types aren't exported from the bun package, so we yoink them from bun's GitHub repo manually.
   This of course means that they might get out of sync with the latest version of bun,
   but hopefully that won't happen too often.

3. The TLS resolution sometimes gets stuck on first request.

   Not sure if we're doing something wrong or is it because the certificates need to be generated.
   If I find time, I'll try to diagnose this.
   In the meantime, it is what it is.
