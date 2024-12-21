# tailscale-js

> [!IMPORTANT]  
> Because every runtime has its own FFI, this library is currently only compatible with [Bun](https://bun.sh).

**Quick start:**

1. get the shared library from https://github.com/mastermakrela/libtailscale/tree/extend-c-functionality
   and compile it with `go build -buildmode=c-shared`

   - either copy the built `libtailscale` to the root of your project
   - or specify the path to the shared library as an environment variable `LIBTAILSCALE_SO_PATH`

2. install the library

```bash
bunx jsr add @mastermakrela/tailscale-js
```

3. use the library where you have used `Bun.serve` before:

```typescript
import Tailscale from "@mastermakrela/tailscale-js";

Tailscale.serve({
	fetch(req) {
		return new Response("Bun through Tailscale!");
	},
});
```

If you want to expose the server to the internet using a [funnel](https://tailscale.com/kb/1223/funnel),
you can use `Tailscale.funnel` instead of `Tailscale.serve`.

---

TODO:

- write better docs
- bundle the shared library for even faster startup
- more???
