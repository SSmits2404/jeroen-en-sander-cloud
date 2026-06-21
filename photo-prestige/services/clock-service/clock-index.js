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

// RabbitMQ connection with auto-retry
let channel;
const initRabbitMQ = async (retries = 5) => {
    while (retries) {
        try {
            const connection = await amqp.connect(process.env.RABBITMQ_URL);
            channel = await connection.createChannel();
            await channel.assertExchange('photo-prestige', 'topic', { durable: true });
            logger.info('RabbitMQ connected and exchange asserted (Clock Service)');
            return;
        } catch (error) {
            logger.error(`RabbitMQ connection failed. Retries left: ${retries - 1}`, error);
            retries -= 1;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    logger.error('Clock service could not connect to RabbitMQ, tasks will log but cannot dispatch events.');
};

// Publish event to queue
const publishEvent = async (eventName, data) => {
    if (!channel) {
        logger.warn(`Event ${eventName} skipped: No RabbitMQ channel.`);
        return;
    }
    try {
        channel.publish(
            'photo-prestige',
            eventName,
            Buffer.from(JSON.stringify(data)),
            { persistent: true }
        );
        logger.info(`Event published by Clock: ${eventName}`);
    } catch (error) {
        logger.error('Event publish failed from clock:', error);
    }
};

// Helper function to verify if a table exists before querying it
const tableExists = async (tableName) => {
    try {
        const res = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1);`,
            [tableName]
        );
        return res.rows[0].exists;
    } catch (e) {
        return false;
    }
};

// ==================== ROUTES ====================

// Health checks
app.get('/clock/health', (req, res) => {
    res.json({ status: 'OK', service: 'clock-service', timestamp: new Date() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'clock-service', timestamp: new Date() });
});

// List scheduled jobs
app.get('/clock/jobs', (req, res) => {
    res.json({ 
        message: 'Clock service is running with scheduled tasks',
        jobs: [
            { name: 'hourly-cleanup', schedule: '0 * * * *', description: 'Cleanup expired sessions' },
            { name: 'daily-report', schedule: '0 2 * * *', description: 'Generate daily reports' },
            { name: 'weekly-stats', schedule: '0 3 * * 0', description: 'Calculate weekly statistics' },
            { name: 'target-deadline-check', schedule: '* * * * *', description: 'Checks for targets that reached their deadline' }
        ]
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== SCHEDULED TASKS ====================

// Hourly cleanup task - remove expired sessions (With fallback if table doesn't exist yet)
cron.schedule('0 * * * *', async () => {
    try {
        logger.info('Running hourly cleanup task');
        
        const hasSessions = await tableExists('sessions');
        let rowCount = 0;

        if (hasSessions) {
            const result = await pool.query(`DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`);
            rowCount = result.rowCount;
        } else {
            logger.warn('Table "sessions" does not exist. Skipping physical deletion.');
        }
        
        await publishEvent('cleanup.completed', {
            task: 'session-cleanup',
            deletedCount: rowCount,
            timestamp: new Date()
        });
        
        logger.info(`Cleaned up ${rowCount} expired sessions`);
    } catch (error) {
        logger.error('Hourly cleanup error:', error);
    }
});

// Daily report generation at 2 AM (Safe query fallback to 'users' and 'photos')
cron.schedule('0 2 * * *', async () => {
    try {
        logger.info('Generating daily report');
        let statsData = { total_users: 0, active_users: 0, latest_activity: new Date() };
        
        const hasActivities = await tableExists('user_activities');
        
        if (hasActivities) {
            const stats = await pool.query(`
                SELECT 
                    COUNT(*) as total_users,
                    COUNT(DISTINCT user_id) as active_users,
                    MAX(created_at) as latest_activity
                FROM user_activities
                WHERE created_at >= CURRENT_DATE
            `);
            statsData = stats.rows[0];
        } else {
            // Fallback op tabellen waarvan we zeker weten dat ze bestaan uit de database-inspectie
            const fallbackStats = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as total_users,
                    (SELECT COUNT(DISTINCT user_id) FROM photos) as active_users,
                    CURRENT_TIMESTAMP as latest_activity
            `);
            statsData = fallbackStats.rows[0];
        }
        
        await publishEvent('report.generated', {
            type: 'daily',
            stats: statsData,
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
        let statsData = { unique_users: 0, total_activities: 0, avg_session_duration: 0 };
        
        const hasActivities = await tableExists('user_activities');
        
        if (hasActivities) {
            const stats = await pool.query(`
                SELECT 
                    COUNT(DISTINCT user_id) as unique_users,
                    COUNT(*) as total_activities,
                    AVG(duration) as avg_session_duration
                FROM user_activities
                WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
            `);
            statsData = stats.rows[0];
        } else {
            const fallbackStats = await pool.query(`
                SELECT 
                    COUNT(DISTINCT user_id) as unique_users,
                    COUNT(*) as total_activities,
                    0 as avg_session_duration
                FROM photos
                WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
            `);
            statsData = fallbackStats.rows[0];
        }
        
        await publishEvent('statistics.calculated', {
            period: 'weekly',
            stats: statsData,
            timestamp: new Date()
        });
        
        logger.info('Weekly statistics calculated successfully');
    } catch (error) {
        logger.error('Weekly statistics calculation error:', error);
    }
});

// Elke minuut controleren op verlopen target-deadlines (* * * * *)
cron.schedule('* * * * *', async () => {
    try {
        logger.info('[CLOCK] Controleren op verlopen target-deadlines...');
        
        const hasTargets = await tableExists('targets');
        if (!hasTargets) {
            logger.warn('[CLOCK] Tabel "targets" bestaat nog niet. Overslaan.');
            return;
        }

        // Haal alle actieve targets op die de deadline zijn gepasseerd
        const expiredTargets = await pool.query(
            `SELECT id, user_id, title, deadline 
             FROM targets 
             WHERE status = 'active' AND deadline <= CURRENT_TIMESTAMP`
        );

        if (expiredTargets.rows.length === 0) {
            return; // Geen verlopen targets gevonden op dit moment
        }

        logger.info(`[CLOCK] ${expiredTargets.rows.length} verlopen target(s) gevonden! Events dispatchen...`);

        for (const target of expiredTargets.rows) {
            // Drop het event op de RabbitMQ Topic Exchange
            await publishEvent('target.deadline.reached', {
                targetId: target.id,
                userId: target.user_id,
                title: target.title,
                deadline: target.deadline,
                timestamp: new Date()
            });
            
            logger.info(`[CLOCK] Event 'target.deadline.reached' verzonden voor target: ${target.id}`);
        }
    } catch (error) {
        logger.error('[CLOCK] Fout tijdens het controleren van target-deadlines:', error);
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
            logger.info('Scheduled tasks initialized safely');
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