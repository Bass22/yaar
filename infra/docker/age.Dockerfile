# syntax=docker/dockerfile:1
# `age`, the encryption of the backups (Z.4): a public key encrypts on the server, the private
# key — kept off the server — decrypts. In an image of its own, so neither the server nor a
# laptop has to install it. No network, no volume: it reads stdin and writes stdout.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
  && apt-get install -y --no-install-recommends age \
  && rm -rf /var/lib/apt/lists/*
USER nobody
ENTRYPOINT ["age"]
