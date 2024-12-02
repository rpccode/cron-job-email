# Usa la imagen oficial de Node.js
FROM node:18

# Crea el directorio de trabajo
WORKDIR /usr/src/app

# Copia los archivos del proyecto
COPY package*.json ./
RUN npm install

COPY . .  

# Expone el puerto (si es necesario)
EXPOSE 3000

# Ejecuta el script
CMD ["node", "src/checkAndSendEmail.js"]
