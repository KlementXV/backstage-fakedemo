FROM nginx:alpine

COPY index.html styles.css script.js /usr/share/nginx/html/

EXPOSE 80

