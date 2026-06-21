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
const fs = require('fs');

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

// Zorg ervoor dat de upload map bestaat bij opstarten
const uploadDir = process.env.UPLOAD_DIR || 'uploads/';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

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
    dest: uploadDir,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // FIX: Geef een specifieke custom error mee die we beneden netjes kunnen opvangen
            const err = new Error('Invalid file type. Only image files (JPEG, PNG, GIF, WEBP) are allowed.');
            err.code = 'INVALID_FILE_TYPE';
            cb(err);
        }
    }
});

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
            logger.info('RabbitMQ connected (Register Service)');
            return;
        } catch (error) {
            logger.error(`RabbitMQ connection failed for Register Service. Retries left: ${retries - 1}`, error);
            retries -= 1;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    logger.error('Register Service kon niet verbinden met RabbitMQ. Events worden niet verzonden!');
};

// Publish event to queue
const publishEvent = async (eventName, data) => {
    if (!channel) {
        logger.warn(`Event ${eventName} niet verzonden: RabbitMQ kanaal onbeschikbaar.`);
        return;
    }
    try {
        channel.publish(
            'photo-prestige',
            eventName,
            Buffer.from(JSON.stringify(data)),
            { persistent: true }
        );
        logger.info(`Event gepubliceerd: ${eventName}`);
    } catch (error) {
        logger.error('Event publish failed in register-service:', error);
    }
};

// ==================== ROUTES ====================

// Health checks
app.get('/register/health', (req, res) => {
    res.json({ status: 'OK', service: 'register-service', timestamp: new Date() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'register-service', timestamp: new Date() });
});

// Register/Upload a new photo
app.post('/register/photo', upload.single('photo'), async (req, res) => {
    try {
        const { userId, participant_id, title, description, tags } = req.body;

        const resolvedParticipantId = participant_id || userId;

        if (!resolvedParticipantId || !req.file) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Missing required fields: userId/participant_id and photo file' });
        }

        if (!title || title.trim() === '') {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Photo title is required' });
        }

        const userCheck = await pool.query(
            'SELECT id FROM users WHERE id = $1',
            [resolvedParticipantId]
        );

        if (userCheck.rows.length === 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Target user does not exist' });
        }

        const result = await pool.query(
            `INSERT INTO photos (
                user_id,
                participant_id,
                title,
                description,
                image_url,
                file_path,
                tags,
                status,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            RETURNING id, user_id, participant_id, title, description, image_url, created_at`,
            [
                resolvedParticipantId,   // user_id
                resolvedParticipantId,   // participant_id (critical fix)
                title.trim(),
                description || null,
                req.file.filename,
                req.file.path,
                tags || null,
                'pending'
            ]
        );

        const photo = result.rows[0];

        await publishEvent('photo.registered', {
            photoId: photo.id,
            userId: photo.user_id,
            participant_id: photo.participant_id,
            filename: req.file.filename,
            title: photo.title,
            timestamp: new Date()
        });

        logger.info(`Photo registered: ${photo.id} by user ${resolvedParticipantId}`);

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
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        logger.error('Photo registration error:', error);
        res.status(500).json({ error: 'Failed to register photo' });
    }
});

// Register bulk photos
app.post('/register/photos/bulk', upload.array('photos', 10), async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId || !req.files || req.files.length === 0) {
            if (req.files) req.files.forEach(f => fs.unlinkSync(f.path));
            return res.status(400).json({ error: 'Missing required fields: userId and photos array' });
        }

        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            req.files.forEach(f => fs.unlinkSync(f.path));
            return res.status(404).json({ error: 'Target user does not exist' });
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
                title: photo.title,
                timestamp: new Date()
            });
        }

        logger.info(`Bulk registered ${photos.length} photos for user ${userId}`);

        res.status(201).json({
            message: `${photos.length} photos registered successfully`,
            photos: photos
        });
    } catch (error) {
        if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
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
            'SELECT id, title, description, tags FROM photos WHERE id = $1',
            [photoId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const currentPhoto = checkResult.rows[0];

        // FIX: Gebruik pure JavaScript fallbacks in plaats van risicovolle SQL COALESCE combinaties
        const finalTitle = title !== undefined ? title : currentPhoto.title;
        const finalDescription = description !== undefined ? description : currentPhoto.description;
        const finalTags = tags !== undefined ? tags : currentPhoto.tags;

        // Update photo
        const result = await pool.query(
            `UPDATE photos 
             SET title = $1,
                 description = $2,
                 tags = $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4
             RETURNING id, title, description, tags, updated_at`,
            [finalTitle, finalDescription, finalTags, photoId]
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

// Delete a photo from DB and physical storage
app.delete('/register/photos/:photoId', async (req, res) => {
    try {
        const { photoId } = req.params;

        // Haal eerst het bestandspad op voor opschoning
        const fileResult = await pool.query('SELECT file_path FROM photos WHERE id = $1', [photoId]);
        
        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const filePath = fileResult.rows[0].file_path;

        const result = await pool.query(
            `DELETE FROM photos WHERE id = $1 RETURNING id, title`,
            [photoId]
        );

        const photo = result.rows[0];

        // Verwijder het fysieke bestand van de harde schijf (voorkom serververvuiling)
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`Physical file deleted: ${filePath}`);
        }

        // Publish event
        await publishEvent('photo.deleted', {
            photoId: photo.id,
            title: photo.title,
            timestamp: new Date()
        });

        logger.info(`Photo record deleted from database: ${photoId}`);

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
    logger.error('Unhandled error in register-service:', err);
    
    // FIX: Vang ook onze custom 'INVALID_FILE_TYPE' op met een nette 400 response
    if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: err.message });
    }

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
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