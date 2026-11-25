# syntax=docker/dockerfile:1
#
# Asterisk, compiled from the official release tarball.
#
# The console normally installs the rolling `andrius/asterisk` images, but those
# tags can lag upstream: at the time of writing they carried 20.21.0, 22.11.0
# and 24.0.0-rc3 while 20.22.0, 22.12.0 and 24.0.0 were already released. This
# file builds the release you name, so the wizard can offer the current one:
#
#   docker build -t asterisk-console/asterisk:22.12.0 \
#     --build-arg ASTERISK_VERSION=22.12.0 asterisk
#
# The console uses an image tagged asterisk-console/asterisk:<release> when it
# exists on the host, and falls back to the registry tag otherwise. It mounts
# its own <data>/pbx at /etc/asterisk, so no configuration is baked in here.
#
# One stage on purpose: every library Asterisk linked against is still present
# at runtime, which matters more than image size for a PBX.
FROM debian:trixie-slim

ARG ASTERISK_VERSION=22.12.0
LABEL org.opencontainers.image.title="Asterisk" \
      org.opencontainers.image.version="${ASTERISK_VERSION}" \
      org.opencontainers.image.source="https://github.com/innotelinc/asterisk-console"

ENV DEBIAN_FRONTEND=noninteractive

# Build toolchain plus the optional libraries Asterisk probes for; whatever is
# missing simply disables its module in menuselect.
RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf automake build-essential ca-certificates curl libtool pkg-config \
      libcurl4-openssl-dev libedit-dev libjansson-dev liblua5.4-dev libncurses-dev \
      libogg-dev libopus-dev libsndfile1-dev libspandsp-dev libspeex-dev \
      libspeexdsp-dev libsqlite3-dev libsrtp2-dev libssl-dev libvorbis-dev \
      libxml2-dev uuid-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/asterisk.tar.gz \
      "https://downloads.asterisk.org/pub/telephony/asterisk/releases/asterisk-${ASTERISK_VERSION}.tar.gz" \
    && mkdir -p /usr/src/asterisk \
    && tar -xzf /tmp/asterisk.tar.gz -C /usr/src/asterisk --strip-components=1 \
    && rm /tmp/asterisk.tar.gz

WORKDIR /usr/src/asterisk

# Bundled pjproject and jansson keep SIP and the config parser independent of
# whatever the distribution ships; both are downloaded during configure.
RUN ./configure --with-pjproject-bundled --with-jansson-bundled --disable-xmldoc

RUN make -j"$(nproc)" && make install

# The console writes /etc/asterisk and owns the other three trees through
# bind mounts, so the runtime user has to match the console's uid (1000).
RUN groupadd -g 1000 asterisk \
    && useradd -u 1000 -g asterisk -d /var/lib/asterisk -s /usr/sbin/nologin asterisk \
    && mkdir -p /etc/asterisk /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk \
    && chown -R asterisk:asterisk \
         /etc/asterisk /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk

USER asterisk

# AMI, SIP and the RTP range the console publishes one to one.
EXPOSE 5038/tcp 5060/udp 10000-10199/udp

CMD ["asterisk", "-f"]
