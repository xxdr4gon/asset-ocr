FROM nginx:1.27-alpine

RUN apk add --no-cache openssl bash

COPY default.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /docker-entrypoint.d/10-generate-cert.sh

RUN chmod +x /docker-entrypoint.d/10-generate-cert.sh

EXPOSE 8443


