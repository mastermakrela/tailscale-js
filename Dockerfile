FROM ghcr.io/mastermakrela/libtailscale:latest AS builder

FROM oven/bun:debian
COPY --from=builder ./libtailscale.so /lib/libtailscale.so

ENV LIBTAILSCALE_SO_PATH=/lib/libtailscale.so