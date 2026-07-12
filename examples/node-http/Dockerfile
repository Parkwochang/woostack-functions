FROM node:22.19.0-alpine

WORKDIR /app
COPY --chown=node:node index.mjs ./

USER 1000:1000
EXPOSE 8080

CMD ["node", "index.mjs"]
