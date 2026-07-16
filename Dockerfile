# AI社長アプリ（依存ゼロ Node サーバー）
FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
COPY data ./data
COPY public ./public
ENV NODE_ENV=production
# Cloud Run は PORT 環境変数を注入する（server.js が process.env.PORT を参照）
CMD ["node", "server.js"]
