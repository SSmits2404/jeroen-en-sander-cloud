// services/register-service/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const amqp = require('amqplib');
const multer = require('multer');
const { Pool } = require('pg');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'register-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message) } }));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50
});
app.use('/register/', limiter);

// File upload configuration
const upload = multer({
    dest: process.env.UPLOAD_DIR || 'uploads/',
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only image files are allowed.'));
        }
    }
});

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
app.get('/register/health', (req, res) => {
    res.json({ status: 'OK', service: 'register-service', timestamp: new Date() });
});

// Register/Upload a new photo
app.post('/register/photo', upload.single('photo'), async (req, res) => {
    try {
        const { userId, title, description, tags } = req.body;

        if (!userId || !req.file) {
            return res.status(400).json({ error: 'Missing required fields: userId and photo file' });
        }

        if (!title) {
            return res.status(400).json({ error: 'Photo title is required' });
        }

        // Insert photo record
        const result = await pool.query(
            `INSERT INTO photos (user_id, title, description, image_url, file_path, tags, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
             RETURNING id, user_id, title, description, image_url, created_at`,
            [userId, title, description || null, req.file.filename, req.file.path, tags || null, 'pending']
        );

        const photo = result.rows[0];

        // Publish event for processing
        await publishEvent('photo.registered', {
            photoId: photo.id,
            userId: photo.user_id,
            filename: req.file.filename,
            title: photo.title,
            timestamp: new Date()
        });

        logger.info(`Photo registered: ${photo.id} by user ${userId}`);

        res.status(201).json({
            message: 'Photo registered successfully',
            photo: {
                id: photo.id,
                title: photo.title,
                description: photo.description,
                status: 'pending',
                createdAt: photo.created_at
            }
        });
    } catch (error) {
        logger.error('Photo registration error:', error);
        res.status(500).json({ error: 'Failed to register photo' });
    }
});

// Register bulk photos
app.post('/register/photos/bulk', upload.array('photos', 10), async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId || !req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const photos = [];

        for (const file of req.files) {
            const result = await pool.query(
                `INSERT INTO photos (user_id, title, description, image_url, file_path, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                 RETURNING id, user_id, title, image_url, created_at`,
                [userId, file.originalname, null, file.filename, file.path, 'pending']
            );

            const photo = result.rows[0];
            photos.push(photo);

            // Publish event
            await publishEvent('photo.registered', {
                photoId: photo.id,
                userId: photo.user_id,
                filename: file.filename,
                timestamp: new Date()
            });
        }

        logger.info(`Bulk registered ${photos.length} photos for user ${userId}`);

        res.status(201).json({
            message: `${photos.length} photos registered successfully`,
            photos: photos
        });
    } catch (error) {
        logger.error('Bulk photo registration error:', error);
        res.status(500).json({ error: 'Failed to register photos' });
    }
});

// Update photo metadata
app.put('/register/photos/:photoId', async (req, res) => {
    try {
        const { photoId } = req.params;
        const { title, description, tags } = req.body;

        // Check if photo exists
        const checkResult = await pool.query(
            'SELECT id FROM photos WHERE id = $1',
            [photoId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        // Update photo
        const result = await pool.query(
            `UPDATE photos 
             SET title = COALESCE($1, title),
                 description = COALESCE($2, description),
                 tags = COALESCE($3, tags),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4
             RETURNING id, title, description, tags, updated_at`,
            [title || null, description || null, tags || null, photoId]
        );

        const photo = result.rows[0];

        // Publish event
        await publishEvent('photo.updated', {
            photoId: photo.id,
            title: photo.title,
            timestamp: new Date()
        });

        logger.info(`Photo updated: ${photoId}`);

        res.json({
            message: 'Photo updated successfully',
            photo: photo
        });
    } catch (error) {
        logger.error('Photo update error:', error);
        res.status(500).json({ error: 'Failed to update photo' });
    }
});

// Publish a photo (make it public)
app.post('/register/photos/:photoId/publish', async (req, res) => {
    try {
        const { photoId } = req.params;

        const result = await pool.query(
            `UPDATE photos 
             SET status = 'published', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, title, status, updated_at`,
            [photoId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const photo = result.rows[0];

        // Publish event
        await publishEvent('photo.published', {
            photoId: photo.id,
            status: 'published',
            timestamp: new Date()
        });

        logger.info(`Photo published: ${photoId}`);

        res.json({
            message: 'Photo published successfully',
            photo: photo
        });
    } catch (error) {
        logger.error('Photo publish error:', error);
        res.status(500).json({ error: 'Failed to publish photo' });
    }
});

// Delete a photo
app.delete('/register/photos/:photoId', async (req, res) => {
    try {
        const { photoId } = req.params;

        const result = await pool.query(
            `DELETE FROM photos WHERE id = $1 RETURNING id, title`,
            [photoId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const photo = result.rows[0];

        // Publish event
        await publishEvent('photo.deleted', {
            photoId: photo.id,
            title: photo.title,
            timestamp: new Date()
        });

        logger.info(`Photo deleted: ${photoId}`);

        res.json({
            message: 'Photo deleted successfully'
        });
    } catch (error) {
        logger.error('Photo deletion error:', error);
        res.status(500).json({ error: 'Failed to delete photo' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
    }
    
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
            logger.info(`Register Service running on port ${PORT}`);
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
