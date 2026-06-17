require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'mail-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message) } }));

// Email transporter setup with fallback to log-only transport if credentials are missing
let transporter;
const smtpConfigured = process.env.EMAIL_USER && process.env.EMAIL_PASSWORD;

if (smtpConfigured) {
    transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    transporter.verify((error, success) => {
        if (error) {
            logger.error('SMTP Transporter verification failed:', error);
        } else {
            logger.info('SMTP Transporter is ready to send emails');
        }
    });
} else {
    logger.warn('SMTP credentials missing in .env. Mail service will run in LOG-ONLY mode (simulating emails).');
    transporter = {
        sendMail: async (options) => {
            logger.info(`[SIMULATED EMAIL] To: ${options.to} | Subject: ${options.subject} | Content: ${options.html ? 'HTML content' : options.text}`);
            return { messageId: 'simulated-id' };
        }
    };
}

// RabbitMQ connection and subscription with auto-retry
let channel;
const initRabbitMQ = async (retries = 5) => {
    while (retries) {
        try {
            const connection = await amqp.connect(process.env.RABBITMQ_URL);
            channel = await connection.createChannel();
            
            await channel.assertExchange('photo-prestige', 'topic', { durable: true });
            const queue = await channel.assertQueue('mail-service-queue', { durable: true });
            
            // FIX: Bind de juiste routing keys zodat ALLE events in de switch-case worden opgevangen!
            await channel.bindQueue(queue.queue, 'photo-prestige', 'user.*');
            await channel.bindQueue(queue.queue, 'photo-prestige', 'photo.*');
            await channel.bindQueue(queue.queue, 'photo-prestige', 'score.*');
            await channel.bindQueue(queue.queue, 'photo-prestige', 'mail.*');
            
            // Consume messages
            channel.consume(queue.queue, async (msg) => {
                if (msg) {
                    try {
                        const content = JSON.parse(msg.content.toString());
                        
                        // Voeg eventName toe vanuit de routing key als deze ontbreekt in de JSON body
                        if (!content.eventName && msg.fields.routingKey) {
                            content.eventName = msg.fields.routingKey;
                        }
                        
                        await handleEmailEvent(content);
                        channel.ack(msg);
                    } catch (error) {
                        logger.error('Message processing error in mail-service:', error);
                        // Als het JSON-parsen faalt of de mail crash, zet het bericht niet in een oneindige lus (requeue: false)
                        channel.nack(msg, false, false);
                    }
                }
            });
            
            logger.info('RabbitMQ connected and consuming mail queues successfully');
            return;
        } catch (error) {
            logger.error(`RabbitMQ connection failed for Mail Service. Retries left: ${retries - 1}`, error);
            retries -= 1;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
};

// Handle incoming email events
const handleEmailEvent = async (event) => {
    const eventType = event.eventName || event.type;
    try {
        switch (eventType) {
            case 'user.registered':
                await sendWelcomeEmail(event);
                break;
            case 'user.passwordReset':
                await sendPasswordResetEmail(event);
                break;
            case 'photo.processed':
            case 'photo.registered': // Extra opvang voor registratie van foto's
                await sendPhotoProcessedEmail(event);
                break;
            case 'score.updated':
                await sendScoreNotification(event);
                break;
            case 'mail.send':
                await sendCustomEmail(event);
                break;
            default:
                logger.warn(`Unknown email event type skipped: ${eventType}`);
        }
    } catch (error) {
        logger.error(`Failed to process email for event ${eventType}:`, error);
        throw error;
    }
};

// Send welcome email
const sendWelcomeEmail = async (event) => {
    const { email, username, firstName } = event;
    if (!email) return;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@photoprestige.com',
        to: email,
        subject: 'Welcome to Photo Prestige!',
        html: `
            <h2>Welcome ${firstName || username}!</h2>
            <p>Thank you for registering at Photo Prestige.</p>
            <p>Your account has been created successfully.</p>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/login">Login to your account</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Welcome email sent to ${email}`);
};

// Send password reset email
const sendPasswordResetEmail = async (event) => {
    const { email, resetToken, userId } = event;
    if (!email) return;
    
    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}&userId=${userId}`;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@photoprestige.com',
        to: email,
        subject: 'Password Reset Request',
        html: `
            <h2>Password Reset Request</h2>
            <p>You requested a password reset. Click the link below to reset your password:</p>
            <a href="${resetLink}">Reset Password</a>
            <p>This link expires in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Password reset email sent to ${email}`);
};

// Send photo processed notification
const sendPhotoProcessedEmail = async (event) => {
    const { email, photoId, image_url, photoUrl, analysis } = event;
    const targetEmail = email || 'participant@photoprestige.com'; // Fallback
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@photoprestige.com',
        to: targetEmail,
        subject: 'Your Photo Has Been Processed!',
        html: `
            <h2>Photo Processing Complete</h2>
            <p>Your photo (ID: ${photoId || event.id}) has been analyzed successfully.</p>
            <img src="${image_url || photoUrl || ''}" alt="Your photo" style="max-width: 300px;">
            <p>Analysis: ${analysis || 'De AI-analyse is voltooid en de score wordt berekend.'}</p>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/photo/${photoId || event.id}">View full analysis</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Photo processed email sent to ${targetEmail}`);
};

// Send score notification
const sendScoreNotification = async (event) => {
    const { email, score, threshold } = event;
    const targetEmail = email || 'participant@photoprestige.com';
    const finalScore = score || event.final_score || 0;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@photoprestige.com',
        to: targetEmail,
        subject: `Your Photo Score: ${finalScore}`,
        html: `
            <h2>Photo Score Update</h2>
            <p>Your photo has received a score of <strong>${finalScore}</strong>.</p>
            ${finalScore >= (threshold || 70) ? '<p>Congratulations! Your photo exceeded the threshold!</p>' : '<p>Keep uploading and improving your skills!</p>'}
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/dashboard">View your dashboard</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Score notification email sent to ${targetEmail}`);
};

// Send custom email
const sendCustomEmail = async (event) => {
    const { to, subject, html, text } = event;
    if (!to) return;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@photoprestige.com',
        to,
        subject: subject || 'Notification from Photo Prestige',
        html: html || text || '<p>Empty notification message.</p>'
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Custom email sent to ${to}`);
};

// ==================== ROUTES ====================

// Health checks
app.get('/mail/health', (req, res) => {
    res.json({ status: 'OK', service: 'mail-service', timestamp: new Date() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'mail-service', timestamp: new Date() });
});

// Send test email
app.post('/mail/test', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email required' });
        }
        
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'noreply@photoprestige.com',
            to: email,
            subject: 'Test Email from Photo Prestige',
            html: '<h2>Test Email</h2><p>This is a test email from the Mail Service.</p>'
        };
        
        await transporter.sendMail(mailOptions);
        res.json({ message: 'Test email processed successfully' });
    } catch (error) {
        logger.error('Test email error:', error);
        res.status(500).json({ error: 'Failed to send test email' });
    }
});

// Start server
const startServer = async () => {
    try {
        await initRabbitMQ();

        app.listen(PORT, () => {
            logger.info(`Mail Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Server startup error:', error);
        process.exit(1);
    }
};

startServer();

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});