// services/read-service/index.js
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
        new winston.transports.File({ filename: 'read-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3003;

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
app.use('/read/', limiter);

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

// ==================== ROUTES ====================

// Health check
app.get('/read/health', (req, res) => {
    res.json({ status: 'OK', service: 'read-service', timestamp: new Date() });
});

// Get all users (read-only)
app.get('/read/users', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const result = await pool.query(
            `SELECT id, username, email, first_name, last_name, role, status, created_at 
             FROM users 
             ORDER BY created_at DESC 
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        const countResult = await pool.query('SELECT COUNT(*) FROM users');

        res.json({
            users: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].count)
            }
        });
    } catch (error) {
        logger.error('Read users error:', error);
        res.status(500).json({ error: 'Failed to read users' });
    }
});

// Get user by ID
app.get('/read/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(
            `SELECT id, username, email, first_name, last_name, role, status, created_at, updated_at 
             FROM users 
             WHERE id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Read user error:', error);
        res.status(500).json({ error: 'Failed to read user' });
    }
});

// Get user's photos
app.get('/read/users/:userId/photos', async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const result = await pool.query(
            `SELECT id, title, description, image_url, created_at, updated_at, status 
             FROM photos 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        const countResult = await pool.query(
            'SELECT COUNT(*) FROM photos WHERE user_id = $1',
            [userId]
        );

        res.json({
            photos: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].count)
            }
        });
    } catch (error) {
        logger.error('Read photos error:', error);
        res.status(500).json({ error: 'Failed to read photos' });
    }
});

// Get photo by ID
app.get('/read/photos/:photoId', async (req, res) => {
    try {
        const { photoId } = req.params;

        const result = await pool.query(
            `SELECT * FROM photos WHERE id = $1`,
            [photoId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Read photo error:', error);
        res.status(500).json({ error: 'Failed to read photo' });
    }
});

// Get photo scores/ratings
app.get('/read/photos/:photoId/scores', async (req, res) => {
    try {
        const { photoId } = req.params;

        const result = await pool.query(
            `SELECT id, score, rating, reviewed_by, created_at 
             FROM scores 
             WHERE photo_id = $1 
             ORDER BY created_at DESC`,
            [photoId]
        );

        const avgResult = await pool.query(
            `SELECT AVG(score) as average_score, COUNT(*) as total_scores 
             FROM scores 
             WHERE photo_id = $1`,
            [photoId]
        );

        res.json({
            scores: result.rows,
            statistics: avgResult.rows[0]
        });
    } catch (error) {
        logger.error('Read scores error:', error);
        res.status(500).json({ error: 'Failed to read scores' });
    }
});

// Get leaderboard
app.get('/read/leaderboard', async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const result = await pool.query(
            `SELECT 
                u.id, 
                u.username, 
                u.first_name, 
                u.last_name,
                COUNT(DISTINCT p.id) as photo_count,
                AVG(s.score) as average_score,
                MAX(s.score) as highest_score
             FROM users u
             LEFT JOIN photos p ON u.id = p.user_id
             LEFT JOIN scores s ON p.id = s.photo_id
             GROUP BY u.id, u.username, u.first_name, u.last_name
             ORDER BY average_score DESC, photo_count DESC
             LIMIT $1`,
            [limit]
        );

        res.json({ leaderboard: result.rows });
    } catch (error) {
        logger.error('Read leaderboard error:', error);
        res.status(500).json({ error: 'Failed to read leaderboard' });
    }
});

// Search photos
app.get('/read/search', async (req, res) => {
    try {
        const { q, page = 1, limit = 20 } = req.query;

        if (!q) {
            return res.status(400).json({ error: 'Search query required' });
        }

        const offset = (page - 1) * limit;

        const result = await pool.query(
            `SELECT id, title, description, image_url, user_id, created_at 
             FROM photos 
             WHERE title ILIKE $1 OR description ILIKE $1
             ORDER BY created_at DESC 
             LIMIT $2 OFFSET $3`,
            [`%${q}%`, limit, offset]
        );

        res.json({
            results: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                query: q
            }
        });
    } catch (error) {
        logger.error('Search error:', error);
        res.status(500).json({ error: 'Failed to search' });
    }
});

// Get statistics
app.get('/read/statistics', async (req, res) => {
    try {
        const userCountResult = await pool.query('SELECT COUNT(*) as count FROM users');
        const photoCountResult = await pool.query('SELECT COUNT(*) as count FROM photos');
        const avgScoreResult = await pool.query('SELECT AVG(score) as avg_score FROM scores');

        res.json({
            statistics: {
                total_users: parseInt(userCountResult.rows[0].count),
                total_photos: parseInt(photoCountResult.rows[0].count),
                average_photo_score: avgScoreResult.rows[0].avg_score || 0
            }
        });
    } catch (error) {
        logger.error('Statistics error:', error);
        res.status(500).json({ error: 'Failed to read statistics' });
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
            logger.info(`Read Service running on port ${PORT}`);
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
