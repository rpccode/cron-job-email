const { Client } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const winston = require('winston');
require('dotenv').config();

// Configuración de Winston para logs
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' }),
  ],
});

// Variables de entorno
const { PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE, MAIL_USER, MAIL_PASS } = process.env;

// Configuración de PostgreSQL
const client = new Client({
  host: PG_HOST,
  port: 5432,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
});

// Configuración de Nodemailer para enviar correos
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'mailhog',
  port: process.env.MAIL_PORT || 1025,
  secure: false, // Mailhog no utiliza TLS/SSL
  logger: true,
  debug: true
});

// Función para reconectar a la base de datos con reintentos
async function connectWithRetry() {
  let retries = 5;
  while (retries) {
    try {
      await client.connect();
      logger.info('Conexión a PostgreSQL exitosa');
      return;
    } catch (err) {
      retries--;
      logger.error(`Error al conectar a PostgreSQL, reintentando (${retries} intentos restantes)...`);
      if (retries === 0) {
        logger.error('No se pudo conectar a PostgreSQL después de varios intentos');
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}

// Función para crear la tabla si no existe
async function createTableIfNotExists() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS emails (
      id SERIAL PRIMARY KEY,
      recipient VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      sent BOOLEAN DEFAULT false
    );
  `;
  try {
    await client.query(createTableQuery);
    logger.info('Tabla "emails" verificada y creada si no existía.');
  } catch (err) {
    logger.error('Error al crear la tabla "emails":', err);
  }
}

// Función para enviar correo con reintentos exponenciales
async function sendMailWithRetry(mailOptions) {
  let retries = 5;
  let delay = 1000; // 1 segundo
  while (retries) {
    try {
      await transporter.sendMail(mailOptions);
      logger.info('Correo enviado con éxito');
      return;
    } catch (error) {
      retries--;
      logger.error(`Error al enviar correo, reintentando en ${delay / 1000} segundos...`, error);
      if (retries === 0) {
        logger.error('No se pudo enviar el correo después de varios intentos');
        return;
      }
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2; // Incrementa el tiempo entre reintentos
    }
  }
}

// Función principal para consultar la base de datos y enviar correos
async function checkAndSendEmail() {
  try {
    // Verificar conexión
    if (client._connected === false) {
      await connectWithRetry();
    }

    // Verificar si la tabla existe y crearla si no es así
    await createTableIfNotExists();

    // Ejecutar consulta
    const res = await client.query("SELECT * FROM emails WHERE sent = false LIMIT 1;");

    // Si hay resultados, enviar un correo
    if (res.rows.length > 0) {
      logger.info('Datos encontrados, enviando correo...');
      const email = res.rows[0];

      const mailOptions = {
        from: 'noreply@example.com',
        to: email.recipient,
        subject: `Datos disponibles en la base de datos: ${email.subject}`,
        text: `Se han encontrado datos en la base de datos que cumplen con la condición. datos: ${email.message}`,
      };

      await client.query('UPDATE emails SET sent = true WHERE id = $1', [email.id]);
      await sendMailWithRetry(mailOptions);
    } else {
      logger.info('No se encontraron datos disponibles');
    }
  } catch (err) {
    logger.error('Error al consultar o enviar el correo:', err);
  }
}



// Programar el cron job para ejecutarse cada 5 segundos
cron.schedule('*/5 * * * * *', checkAndSendEmail);

logger.info('Cron job iniciado. Consultando la base de datos cada 5 segundos...');

// Función para rellenar la tabla 'emails' cada 5 minutos
async function fillTable() {
  try {
    // Verificar conexión
    if (client._connected === false) {
      await connectWithRetry();
    }

    // Insertar datos en la tabla
    const insertQuery = `
      INSERT INTO emails (recipient, subject, message) 
      VALUES 
      ('test1@example.com', 'Prueba 1', 'Este es un mensaje de prueba 1'),
      ('test2@example.com', 'Prueba 2', 'Este es un mensaje de prueba 2'),
      ('test3@example.com', 'Prueba 3', 'Este es un mensaje de prueba 3');
    `;
    await client.query(insertQuery);
    logger.info('Datos insertados en la tabla "emails"');
  } catch (err) {
    logger.error('Error al rellenar la tabla "emails":', err);
  }
}

// Programar un cron job para rellenar la tabla cada 5 minutos
cron.schedule('*/10 * * * * *', fillTable);

logger.info('Cron job para rellenar la tabla iniciado. Ejecutándose cada 10 segundos...');
