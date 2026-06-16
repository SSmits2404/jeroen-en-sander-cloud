// services/clock-service/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const amqp = require('amqplib');
const cron = require('node-cron');
const { Pool } = require('pg');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'clock-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: message => logger.info(message) } }));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// RabbitMQ connection
let channel;
const initRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL);
        channel = await connection.createChannel();
        logger.info('RabbitMQ connected');
    } catch (error) {
        logger.error('RabbitMQ connection failed:', error);
    }
};

// Publish event to queue
const publishEvent = async (eventName, data) => {
    if (!channel) return;
    try {
        await channel.assertExchange('photo-prestige', 'topic', { durable: true });
        channel.publish(
            'photo-prestige',
            eventName,
            Buffer.from(JSON.stringify(data)),
            { persistent: true }
        );
    } catch (error) {
        logger.error('Event publish failed:', error);
    }
};

// ==================== ROUTES ====================

// Health check
app.get('/clock/health', (req, res) => {
    res.json({ status: 'OK', service: 'clock-service', timestamp: new Date() });
});

// List scheduled jobs
app.get('/clock/jobs', (req, res) => {
    res.json({ 
        message: 'Clock service is running with scheduled tasks',
        jobs: [
            { name: 'hourly-cleanup', schedule: '0 * * * *', description: 'Cleanup expired sessions' },
            { name: 'daily-report', schedule: '0 2 * * *', description: 'Generate daily reports' },
            { name: 'weekly-stats', schedule: '0 3 * * 0', description: 'Calculate weekly statistics' }
        ]
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== SCHEDULED TASKS ====================

// Hourly cleanup task - remove expired sessions
cron.schedule('0 * * * *', async () => {
    try {
        logger.info('Running hourly cleanup task');
        
        const result = await pool.query(
            `DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`
        );
        
        await publishEvent('cleanup.completed', {
            task: 'session-cleanup',
            deletedCount: result.rowCount,
            timestamp: new Date()
        });
        
        logger.info(`Cleaned up ${result.rowCount} expired sessions`);
    } catch (error) {
        logger.error('Hourly cleanup error:', error);
    }
});

// Daily report generation at 2 AM
cron.schedule('0 2 * * *', async () => {
    try {
        logger.info('Generating daily report');
        
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(DISTINCT user_id) as active_users,
                MAX(created_at) as latest_activity
            FROM user_activities
            WHERE created_at >= CURRENT_DATE
        `);
        
        await publishEvent('report.generated', {
            type: 'daily',
            stats: stats.rows[0],
            timestamp: new Date()
        });
        
        logger.info('Daily report generated successfully');
    } catch (error) {
        logger.error('Daily report generation error:', error);
    }
});

// Weekly statistics calculation on Sunday at 3 AM
cron.schedule('0 3 * * 0', async () => {
    try {
        logger.info('Calculating weekly statistics');
        
        const stats = await pool.query(`
            SELECT 
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(*) as total_activities,
                AVG(duration) as avg_session_duration
            FROM user_activities
            WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        `);
        
        await publishEvent('statistics.calculated', {
            period: 'weekly',
            stats: stats.rows[0],
            timestamp: new Date()
        });
        
        logger.info('Weekly statistics calculated successfully');
    } catch (error) {
        logger.error('Weekly statistics calculation error:', error);
    }
});

// Start server
const startServer = async () => {
    try {
        await initRabbitMQ();
        
        // Test database connection
        await pool.query('SELECT NOW()');
        logger.info('Database connected');

        app.listen(PORT, () => {
            logger.info(`Clock Service running on port ${PORT}`);
            logger.info('Scheduled tasks initialized');
        });
    } catch (error) {
        logger.error('Server startup error:', error);
        process.exit(1);
    }
};

startServer();

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await pool.end();
    process.exit(0);
});
