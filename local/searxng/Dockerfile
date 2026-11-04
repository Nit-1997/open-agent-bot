FROM searxng/searxng:latest@sha256:0f48ffe2152f388f5eaede27f96b610449cebfc890d0ad457304475a54ad7b6e
COPY settings.yml /opt/open-agent/settings.yml
COPY entrypoint.sh /opt/open-agent/entrypoint.sh
ENV SEARXNG_SETTINGS_PATH=/opt/open-agent/settings.yml
ARG OPEN_AGENT_VERSION=dev
ARG OPEN_AGENT_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Nit-1997/open-agent-bot" \
      org.opencontainers.image.version="${OPEN_AGENT_VERSION}" \
      org.opencontainers.image.revision="${OPEN_AGENT_REVISION}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Open Agent search"
ENTRYPOINT ["/bin/sh", "/opt/open-agent/entrypoint.sh", "/usr/local/searxng/entrypoint.sh"]
