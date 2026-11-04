# nginx in front of the Laravel API (php-fpm), with the vhost of the pinned Toolshop commit
# (_docker/vhost.conf, copied verbatim to docker/api-vhost.conf). Built here because the
# published practice-software-testing-web image only exists for arm64.
FROM nginx:1.23.3-alpine
COPY docker/api-vhost.conf /etc/nginx/conf.d/default.conf
