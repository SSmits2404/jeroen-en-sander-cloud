// services/target-service/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const amqp = require('amqplib');
const { Pool } = require('pg');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'target-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3006;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: message => logger.info(message) } }));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use('/target/', limiter);

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
app.get('/target/health', (req, res) => {
    res.json({ status: 'OK', service: 'target-service', timestamp: new Date() });
});

// Create a new target/goal
app.post('/target/goals', async (req, res) => {
    try {
        const { userId, title, description, targetScore, targetPhotoCount, deadline } = req.body;

        if (!userId || !title) {
            return res.status(400).json({ error: 'Missing required fields: userId and title' });
        }

        const result = await pool.query(
            `INSERT INTO targets (user_id, title, description, target_score, target_photo_count, deadline, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
             RETURNING id, user_id, title, description, target_score, target_photo_count, deadline, status, created_at`,
            [userId, title, description || null, targetScore || null, targetPhotoCount || null, deadline || null, 'active']
        );

        const goal = result.rows[0];

        // Publish event
        await publishEvent('target.created', {
            targetId: goal.id,
            userId: goal.user_id,
            title: goal.title,
            timestamp: new Date()
        });

        logger.info(`Target created: ${goal.id} for user ${userId}`);

        res.status(201).json({
            message: 'Target created successfully',
            target: goal
        });
    } catch (error) {
        logger.error('Target creation error:', error);
        res.status(500).json({ error: 'Failed to create target' });
    }
});

// Get all targets for a user
app.get('/target/users/:userId/goals', async (req, res) => {
    try {
        const { userId } = req.params;
        const { status } = req.query;

        let query = `SELECT * FROM targets WHERE user_id = $1`;
        const params = [userId];

        if (status) {
            query += ` AND status = $2`;
            params.push(status);
        }

        query += ` ORDER BY created_at DESC`;

        const result = await pool.query(query, params);

        res.json({
            targets: result.rows
        });
    } catch (error) {
        logger.error('Fetch targets error:', error);
        res.status(500).json({ error: 'Failed to fetch targets' });
    }
});

// Get a specific target
app.get('/target/goals/:targetId', async (req, res) => {
    try {
        const { targetId } = req.params;

        const result = await pool.query(
            `SELECT * FROM targets WHERE id = $1`,
            [targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }

        const target = result.rows[0];

        // Get progress
        const progressResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT p.id) as photo_count,
                AVG(s.score) as average_score
             FROM photos p
             LEFT JOIN scores s ON p.id = s.photo_id
             WHERE p.user_id = $1`,
            [target.user_id]
        );

        res.json({
            target: target,
            progress: progressResult.rows[0]
        });
    } catch (error) {
        logger.error('Fetch target error:', error);
        res.status(500).json({ error: 'Failed to fetch target' });
    }
});

// Update a target
app.put('/target/goals/:targetId', async (req, res) => {
    try {
        const { targetId } = req.params;
        const { title, description, targetScore, targetPhotoCount, deadline, status } = req.body;

        const result = await pool.query(
            `UPDATE targets 
             SET title = COALESCE($1, title),
                 description = COALESCE($2, description),
                 target_score = COALESCE($3, target_score),
                 target_photo_count = COALESCE($4, target_photo_count),
                 deadline = COALESCE($5, deadline),
                 status = COALESCE($6, status),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $7
             RETURNING id, title, description, target_score, target_photo_count, deadline, status, updated_at`,
            [title || null, description || null, targetScore || null, targetPhotoCount || null, deadline || null, status || null, targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }

        const target = result.rows[0];

        // Publish event
        await publishEvent('target.updated', {
            targetId: target.id,
            status: target.status,
            timestamp: new Date()
        });

        logger.info(`Target updated: ${targetId}`);

        res.json({
            message: 'Target updated successfully',
            target: target
        });
    } catch (error) {
        logger.error('Target update error:', error);
        res.status(500).json({ error: 'Failed to update target' });
    }
});

// Complete a target
app.post('/target/goals/:targetId/complete', async (req, res) => {
    try {
        const { targetId } = req.params;

        // Get target first
        const targetResult = await pool.query(
            `SELECT * FROM targets WHERE id = $1`,
            [targetId]
        );

        if (targetResult.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }

        const target = targetResult.rows[0];

        // Check if target goals are met
        const progressResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT p.id) as photo_count,
                AVG(s.score) as average_score
             FROM photos p
             LEFT JOIN scores s ON p.id = s.photo_id
             WHERE p.user_id = $1`,
            [target.user_id]
        );

        const progress = progressResult.rows[0];

        const goalsMet = {
            photoCount: !target.target_photo_count || progress.photo_count >= target.target_photo_count,
            averageScore: !target.target_score || progress.average_score >= target.target_score
        };

        if (!goalsMet.photoCount || !goalsMet.averageScore) {
            return res.status(400).json({
                error: 'Target goals not met',
                required: {
                    photoCount: target.target_photo_count,
                    averageScore: target.target_score
                },
                current: {
                    photoCount: progress.photo_count,
                    averageScore: progress.average_score
                }
            });
        }

        // Update target status
        const updateResult = await pool.query(
            `UPDATE targets 
             SET status = 'completed', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, title, status, updated_at`,
            [targetId]
        );

        const completedTarget = updateResult.rows[0];

        // Publish event
        await publishEvent('target.completed', {
            targetId: completedTarget.id,
            userId: target.user_id,
            title: completedTarget.title,
            timestamp: new Date()
        });

        logger.info(`Target completed: ${targetId}`);

        res.json({
            message: 'Target completed successfully',
            target: completedTarget
        });
    } catch (error) {
        logger.error('Target completion error:', error);
        res.status(500).json({ error: 'Failed to complete target' });
    }
});

// Delete a target
app.delete('/target/goals/:targetId', async (req, res) => {
    try {
        const { targetId } = req.params;

        const result = await pool.query(
            `DELETE FROM targets WHERE id = $1 RETURNING id, title`,
            [targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }

        const target = result.rows[0];

        // Publish event
        await publishEvent('target.deleted', {
            targetId: target.id,
            title: target.title,
            timestamp: new Date()
        });

        logger.info(`Target deleted: ${targetId}`);

        res.json({
            message: 'Target deleted successfully'
        });
    } catch (error) {
        logger.error('Target deletion error:', error);
        res.status(500).json({ error: 'Failed to delete target' });
    }
});

// Get target progress/statistics
app.get('/target/goals/:targetId/progress', async (req, res) => {
    try {
        const { targetId } = req.params;

        const targetResult = await pool.query(
            `SELECT * FROM targets WHERE id = $1`,
            [targetId]
        );

        if (targetResult.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }

        const target = targetResult.rows[0];

        const progressResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT p.id) as photo_count,
                AVG(s.score) as average_score,
                MAX(s.score) as highest_score,
                MIN(s.score) as lowest_score
             FROM photos p
             LEFT JOIN scores s ON p.id = s.photo_id
             WHERE p.user_id = $1`,
            [target.user_id]
        );

        const progress = progressResult.rows[0];

        const completion = {
            photoCount: target.target_photo_count ? Math.round((progress.photo_count / target.target_photo_count) * 100) : null,
            averageScore: target.target_score ? Math.round((progress.average_score / target.target_score) * 100) : null
        };

        res.json({
            target: target,
            progress: progress,
            completion: completion
        });
    } catch (error) {
        logger.error('Progress fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch progress' });
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
        
        // Test database connection
        await pool.query('SELECT NOW()');
        logger.info('Database connected');

        app.listen(PORT, () => {
            logger.info(`Target Service running on port ${PORT}`);
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
