// services/mail-service/index.js
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

// Email transporter
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Verify transporter connection
transporter.verify((error, success) => {
    if (error) {
        logger.error('Email transporter error:', error);
    } else {
        logger.info('Email transporter is ready');
    }
});

// RabbitMQ connection and subscription
let channel;
const initRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL);
        channel = await connection.createChannel();
        
        // Subscribe to mail events
        await channel.assertExchange('photo-prestige', 'topic', { durable: true });
        const queue = await channel.assertQueue('mail-service-queue', { durable: true });
        
        await channel.bindQueue(queue.queue, 'photo-prestige', 'mail.*');
        await channel.bindQueue(queue.queue, 'photo-prestige', 'user.*');
        
        // Consume messages
        channel.consume(queue.queue, async (msg) => {
            if (msg) {
                try {
                    const content = JSON.parse(msg.content.toString());
                    await handleEmailEvent(content);
                    channel.ack(msg);
                } catch (error) {
                    logger.error('Message processing error:', error);
                    channel.nack(msg, false, true);
                }
            }
        });
        
        logger.info('RabbitMQ connected and consuming messages');
    } catch (error) {
        logger.error('RabbitMQ connection failed:', error);
        setTimeout(initRabbitMQ, 5000); // Retry after 5 seconds
    }
};

// Handle incoming email events
const handleEmailEvent = async (event) => {
    try {
        switch (event.eventName || event.type) {
            case 'user.registered':
                await sendWelcomeEmail(event);
                break;
            case 'user.passwordReset':
                await sendPasswordResetEmail(event);
                break;
            case 'photo.processed':
                await sendPhotoProcessedEmail(event);
                break;
            case 'score.updated':
                await sendScoreNotification(event);
                break;
            case 'mail.send':
                await sendCustomEmail(event);
                break;
            default:
                logger.warn('Unknown email event:', event.eventName);
        }
    } catch (error) {
        logger.error('Email event handling error:', error);
        throw error;
    }
};

// Send welcome email
const sendWelcomeEmail = async (event) => {
    const { email, username, firstName } = event;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: 'Welcome to Photo Prestige!',
        html: `
            <h2>Welcome ${firstName || username}!</h2>
            <p>Thank you for registering at Photo Prestige.</p>
            <p>Your account has been created successfully.</p>
            <a href="${process.env.APP_URL}/login">Login to your account</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Welcome email sent to ${email}`);
};

// Send password reset email
const sendPasswordResetEmail = async (event) => {
    const { email, resetToken, userId } = event;
    
    const resetLink = `${process.env.APP_URL}/reset-password?token=${resetToken}&userId=${userId}`;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
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
    const { email, photoId, photoUrl, analysis } = event;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: 'Your Photo Has Been Processed!',
        html: `
            <h2>Photo Processing Complete</h2>
            <p>Your photo (ID: ${photoId}) has been analyzed successfully.</p>
            <img src="${photoUrl}" alt="Your photo" style="max-width: 300px;">
            <p>Analysis: ${analysis}</p>
            <a href="${process.env.APP_URL}/photo/${photoId}">View full analysis</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Photo processed email sent to ${email}`);
};

// Send score notification
const sendScoreNotification = async (event) => {
    const { email, score, threshold } = event;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: `Your Photo Score: ${score}`,
        html: `
            <h2>Photo Score Update</h2>
            <p>Your photo has received a score of <strong>${score}</strong>.</p>
            ${score >= threshold ? '<p>Congratulations! Your photo exceeded the threshold!</p>' : '<p>Keep uploading and improving your skills!</p>'}
            <a href="${process.env.APP_URL}/dashboard">View your dashboard</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Score notification email sent to ${email}`);
};

// Send custom email
const sendCustomEmail = async (event) => {
    const { to, subject, html, text } = event;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to,
        subject,
        html: html || text
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Custom email sent to ${to}`);
};

// ==================== ROUTES ====================

// Health check
app.get('/mail/health', (req, res) => {
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
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: email,
            subject: 'Test Email from Photo Prestige',
            html: '<h2>Test Email</h2><p>This is a test email from the Mail Service.</p>'
        };
        
        await transporter.sendMail(mailOptions);
        logger.info(`Test email sent to ${email}`);
        
        res.json({ message: 'Test email sent successfully' });
    } catch (error) {
        logger.error('Test email error:', error);
        res.status(500).json({ error: 'Failed to send test email' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
