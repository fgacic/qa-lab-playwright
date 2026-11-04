# The Toolshop Laravel API (sprint 5), built from source at a pinned commit of
# github.com/testsmith-io/practice-software-testing. Mirrors the project's own
# _docker/api.docker (production stage) with exact base-image versions; built from source
# rather than pulled because the published image exists for amd64 only and only per tag.
ARG TOOLSHOP_REF

FROM alpine/git:v2.47.1 AS source
ARG TOOLSHOP_REF
RUN git init /src && cd /src \
 && git remote add origin https://github.com/testsmith-io/practice-software-testing.git \
 && git fetch --depth 1 origin "${TOOLSHOP_REF}" && git checkout FETCH_HEAD

FROM composer:2.8.3 AS composer

FROM php:8.3.13-fpm-alpine3.20
RUN apk add --no-cache mysql-client libzip libpng libjpeg-turbo libwebp freetype icu \
 && apk add --no-cache --virtual .build icu-dev zlib-dev g++ make autoconf libffi-dev libzip-dev libpng-dev libwebp-dev libjpeg-turbo-dev freetype-dev \
 && docker-php-ext-configure gd --enable-gd --with-freetype --with-jpeg --with-webp \
 && docker-php-ext-install gd pdo_mysql ffi intl opcache exif zip \
 && apk del .build
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
COPY --from=source /src/_docker/opcache.ini /src/_docker/php-ini-overrides.ini $PHP_INI_DIR/conf.d/
WORKDIR /var/www
COPY --from=source --chown=www-data:www-data /src/sprint5/API /var/www
RUN composer install --no-dev --optimize-autoloader --ignore-platform-req=ext-ffi --no-interaction \
 && chown -R www-data:www-data /var/www \
 && chmod -R 777 /var/www/storage /var/www/bootstrap/cache
USER www-data
