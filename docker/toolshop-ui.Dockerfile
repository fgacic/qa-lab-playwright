# The Toolshop Angular UI (sprint 5), built for production from a pinned commit of
# github.com/testsmith-io/practice-software-testing. The published UI image only runs the
# Angular dev server (`ng serve`); a production build is what real users get and what visual
# and performance checks should measure.
ARG TOOLSHOP_REF

FROM node:22.12.0-alpine3.21 AS build
ARG TOOLSHOP_REF
ARG API_URL=/api
RUN apk add --no-cache git
RUN git init /src && cd /src \
 && git remote add origin https://github.com/testsmith-io/practice-software-testing.git \
 && git fetch --depth 1 origin "${TOOLSHOP_REF}" && git checkout FETCH_HEAD
WORKDIR /src/sprint5/UI
# Point the production build at the API on the same origin (/api, see ui-nginx.conf) and
# switch analytics off.
RUN sed -i "s#apiUrl: '[^']*'#apiUrl: '${API_URL}'#; s#gaCode: '[^']*'#gaCode: ''#" src/environments/environment.prod.ts \
 && grep -q "${API_URL}" src/environments/environment.prod.ts
RUN npm install --legacy-peer-deps --no-audit --no-fund
RUN npx ng build --configuration production \
 && if [ -d dist/toolshop/browser ]; then mv dist/toolshop/browser /site; else mv dist/toolshop /site; fi

FROM nginx:1.27.3-alpine
COPY docker/ui-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 4200
