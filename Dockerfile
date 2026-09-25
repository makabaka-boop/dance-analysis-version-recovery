# syntax=docker/dockerfile:1

# ---- 构建阶段：依赖、类型检查、Vitest、打包 ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- 运行阶段：Nginx 提供 stage 页面 ----
FROM nginx:1.27-alpine AS stage
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
