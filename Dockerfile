# Bancada de Rede — imagem para Docker e Podman.
# Compila o mesmo binário do executável (dependências em vendor/, sem acesso à internet no build)
# e roda em modo headless: só o servidor, sem painel.
FROM docker.io/library/golang:1.24-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags "-s -w" -o /out/bancada . \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="Bancada de Rede" \
      org.opencontainers.image.description="Lab de redes no navegador com CLI, simulação e exportação multi-fabricante" \
      org.opencontainers.image.version="5.0.0" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /out/bancada /bancada
COPY --from=build --chown=65532:65532 /out/data /data
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
USER nonroot
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/bancada", "--healthcheck"]
ENTRYPOINT ["/bancada", "--headless"]
