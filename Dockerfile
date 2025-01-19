FROM ghcr.io/mastermakrela/libtailscale:20250119-2239 AS builder

FROM oven/bun:debian
COPY --from=builder /var/lib/libtailscale.so /var/lib/libtailscale.so

ENV LIBTAILSCALE_SO_PATH=/var/lib/libtailscale.so