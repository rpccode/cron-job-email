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
  debug: true,
});

// Función para reconectar a la base de datos con reintentos
async function connectWithRetry() {
  const maxRetries = 5;
  const delay = 5000; // 5 segundos
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await client.connect();
      logger.info('Conexión a PostgreSQL exitosa');
      return;
    } catch (err) {
      const remainingRetries = maxRetries - (attempt + 1);
      logger.error(
        `Error al conectar a PostgreSQL. Reintentando en ${delay / 1000} segundos... (${remainingRetries} intentos restantes)`,
        err
      );

      attempt++;
      if (remainingRetries === 0) {
        logger.error('No se pudo conectar a PostgreSQL después de varios intentos');
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}


// Función para verificar la conexión a PostgreSQL
async function ensureConnection() {
  try {
    await client.query('SELECT 1');
  } catch (err) {
    logger.error('Conexión perdida con PostgreSQL, reconectando...');
    await connectWithRetry();
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
    await ensureConnection();
    await createTableIfNotExists();

    // Consultar la base de datos
    const res = await client.query('SELECT * FROM emails WHERE sent = false LIMIT 10;');
    const emailsToSend = res.rows;

    if (emailsToSend.length > 0) {
      logger.info(`Se encontraron ${emailsToSend.length} correos para enviar.`);
      const mailPromises = emailsToSend.map(async (email) => {
        const mailOptions = {
          from: 'noreply@example.com',
          to: email.recipient,
          subject: `Datos disponibles en la base de datos: ${email.subject}`,
          text: `Se han encontrado datos en la base de datos que cumplen con la condición. Datos: ${email.message}`,
        };

        await sendMailWithRetry(mailOptions);
        await client.query('UPDATE emails SET sent = true WHERE id = $1', [email.id]);
      });

      await Promise.all(mailPromises);
    } else {
      logger.info('No se encontraron correos pendientes de envío.');
    }
  } catch (err) {
    logger.error('Error al consultar o enviar el correo:', err);
  }
}

// Cron job para enviar correos cada minuto
cron.schedule('*/1 * * * *', checkAndSendEmail);
logger.info('Cron job para envío de correos iniciado. Ejecutándose cada minuto...');

// Función para rellenar la tabla 'emails' periódicamente
async function fillTable() {
  try {
    await ensureConnection();

    const insertQuery = `
      INSERT INTO emails (recipient, subject, message) 
      VALUES 
      ('test1@example.com', 'Prueba 1', 'Este es un mensaje de prueba 1'),
      ('test2@example.com', 'Prueba 2', 'Este es un mensaje de prueba 2'),
      ('test3@example.com', 'Prueba 3', 'Este es un mensaje de prueba 3');
    `;
    await client.query(insertQuery);
    logger.info('Datos insertados en la tabla "emails".');
  } catch (err) {
    logger.error('Error al rellenar la tabla "emails":', err);
  }
}

// Cron job para rellenar la tabla cada 10 minutos
cron.schedule('*/10 * * * *', fillTable);
logger.info('Cron job para rellenar la tabla iniciado. Ejecutándose cada 10 minutos...');
