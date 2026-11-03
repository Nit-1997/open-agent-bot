FROM searxng/searxng:latest@sha256:0f48ffe2152f388f5eaede27f96b610449cebfc890d0ad457304475a54ad7b6e
COPY settings.yml /etc/searxng/settings.yml
COPY entrypoint.sh /opt/open-agent/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/opt/open-agent/entrypoint.sh", "/usr/local/searxng/entrypoint.sh"]
