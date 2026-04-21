FROM node:20-alpine AS vendor

WORKDIR /tmp/vendor
RUN npm init -y && npm install three@0.164.1
RUN mkdir -p /opt/vendor \
    && cp node_modules/three/build/three.module.js /opt/vendor/three.module.js \
    && cp node_modules/three/examples/jsm/controls/OrbitControls.js /opt/vendor/OrbitControls.js \
    && sed -i "s/from 'three';/from '.\\/three.module.js';/" /opt/vendor/OrbitControls.js

FROM nginx:1.27-alpine

COPY frontend/index.html /usr/share/nginx/html/index.html
COPY frontend/style.css /usr/share/nginx/html/style.css
COPY frontend/app.js /usr/share/nginx/html/app.js
COPY frontend/assets /usr/share/nginx/html/assets
COPY --from=vendor /opt/vendor /usr/share/nginx/html/vendor

EXPOSE 80
