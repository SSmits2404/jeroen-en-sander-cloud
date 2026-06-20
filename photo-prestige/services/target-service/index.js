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

const client = require('prom-client');

// Verzamel standaard Node.js/V8 metrics (CPU, geheugen, etc.)
client.collectDefaultMetrics({ register: client.register });

// Custom counter om het aantal request te meten voor je dashboard
const httpRequestsTotal = new client.Counter({
  name: 'target_service_http_requests_total',
  help: 'Totaal aantal HTTP requests naar de Target Service',
  labelNames: ['method', 'route', 'status_code']
});

// Middleware om elke request automatisch te tellen
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestsTotal.labels(req.method, req.route ? req.route.path : req.path, res.statusCode).inc();
  });
  next();
});

const PORT = process.env.PORT || 3003; // We zetten deze nu ook hard op 3003 zodat het synchroon loopt met je logs!

// ==================== CIRCUIT BREAKER CONFIG ====================

const createBreaker = require('./shared/circuitBreaker'); // Pad aanpassen naar waar je bestand staat
const axios = require('axios');

// 1. Definieer de specifieke call voor deze service
const callScoreService = async (data) => {
    return await axios.post('http://score-service:3006/scores/calculate', data);
};

// 2. Initialiseer de breaker
const breaker = createBreaker(callScoreService);

// 3. Fallback definiëren (specifiek per service)
breaker.fallback((error) => {
    return { data: { error: 'Service is momenteel niet beschikbaar.' } };
});

// Gebruik in je route
app.post('/target/analyze-photo', async (req, res) => {
    const result = await breaker.fire(req.body);
    res.json(result.data);
});

// ==================== MIDDLEWARE ====================
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

// Database verbinding
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// RabbitMQ verbinding met automatische retry-lus
let channel;
const initRabbitMQ = async (retries = 5) => {
    while (retries) {
        try {
            const connection = await amqp.connect(process.env.RABBITMQ_URL);
            channel = await connection.createChannel();
            await channel.assertExchange('photo-prestige', 'topic', { durable: true });
            logger.info('RabbitMQ connected (Target Service)');
            return;
        } catch (error) {
            logger.error(`RabbitMQ connection failed for Target Service. Retries left: ${retries - 1}`, error);
            retries -= 1;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
};

// Publish event naar queue
const publishEvent = async (eventName, data) => {
    if (!channel) return;
    try {
        channel.publish(
            'photo-prestige',
            eventName,
            Buffer.from(JSON.stringify(data)),
            { persistent: true }
        );
    } catch (error) {
        logger.error('Event publish failed in target-service:', error);
    }
};

// ==================== ROUTES ====================

// Health checks
app.get('/target/health', (req, res) => {
    res.json({ status: 'OK', service: 'target-service', timestamp: new Date() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'target-service', timestamp: new Date() });
});

// Create a new target/goal
app.post('/target/goals', async (req, res) => {
    try {
        const { userId, title, description, targetScore, targetPhotoCount, deadline } = req.body;
        if (!userId || !title) {
            return res.status(400).json({ error: 'Missing required fields: userId and title' });
        }
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const result = await pool.query(
            `INSERT INTO targets (user_id, title, description, target_score, target_photo_count, deadline, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
             RETURNING id, user_id, title, description, target_score, target_photo_count, deadline, status, created_at`,
            [userId, title.trim(), description || null, targetScore || null, targetPhotoCount || null, deadline || null, 'active']
        );
        const goal = result.rows[0];
        await publishEvent('target.created', {
            targetId: goal.id,
            userId: goal.user_id,
            title: goal.title,
            timestamp: new Date()
        });
        logger.info(`Target created: ${goal.id} for user ${userId}`);
        res.status(201).json({ message: 'Target created successfully', target: goal });
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
        res.json({ targets: result.rows });
    } catch (error) {
        logger.error('Fetch targets error:', error);
        res.status(500).json({ error: 'Failed to fetch targets' });
    }
});

// Get a specific target
app.get('/target/goals/:targetId', async (req, res) => {
    try {
        const { targetId } = req.params;
        const result = await pool.query(`SELECT * FROM targets WHERE id = $1`, [targetId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }
        const target = result.rows[0];
        const progressResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT p.id)::int as photo_count,
                COALESCE(AVG(s.final_score)::float, 0.0) as average_score
             FROM photos p
             LEFT JOIN scores s ON p.id = s.photo_id
             WHERE p.user_id = $1`,
            [target.user_id]
        );
        res.json({ target: target, progress: progressResult.rows[0] });
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
        const checkResult = await pool.query('SELECT * FROM targets WHERE id = $1', [targetId]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }
        const currentTarget = checkResult.rows[0];
        const finalTitle = title !== undefined ? title : currentTarget.title;
        const finalDescription = description !== undefined ? description : currentTarget.description;
        const finalTargetScore = targetScore !== undefined ? targetScore : currentTarget.target_score;
        const finalTargetPhotoCount = targetPhotoCount !== undefined ? targetPhotoCount : currentTarget.target_photo_count;
        const finalDeadline = deadline !== undefined ? deadline : currentTarget.deadline;
        const finalStatus = status !== undefined ? status : currentTarget.status;

        const result = await pool.query(
            `UPDATE targets 
             SET title = $1, description = $2, target_score = $3, target_photo_count = $4, deadline = $5, status = $6, updated_at = CURRENT_TIMESTAMP
             WHERE id = $7
             RETURNING id, title, description, target_score, target_photo_count, deadline, status, updated_at`,
            [finalTitle, finalDescription, finalTargetScore, finalTargetPhotoCount, finalDeadline, finalStatus, targetId]
        );
        const target = result.rows[0];
        await publishEvent('target.updated', { targetId: target.id, status: target.status, timestamp: new Date() });
        logger.info(`Target updated: ${targetId}`);
        res.json({ message: 'Target updated successfully', target: target });
    } catch (error) {
        logger.error('Target update error:', error);
        res.status(500).json({ error: 'Failed to update target' });
    }
});

// Complete a target
app.post('/target/goals/:targetId/complete', async (req, res) => {
    try {
        const { targetId } = req.params;
        const targetResult = await pool.query(`SELECT * FROM targets WHERE id = $1`, [targetId]);
        if (targetResult.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }
        const target = targetResult.rows[0];
        const progressResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT p.id)::int as photo_count,
                COALESCE(AVG(s.final_score)::float, 0.0) as average_score
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
                required: { photoCount: target.target_photo_count, averageScore: target.target_score },
                current: { photoCount: progress.photo_count, averageScore: progress.average_score }
            });
        }

        const updateResult = await pool.query(
            `UPDATE targets SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, title, status, updated_at`,
            [targetId]
        );
        const completedTarget = updateResult.rows[0];
        await publishEvent('target.completed', { targetId: completedTarget.id, userId: target.user_id, title: completedTarget.title, timestamp: new Date() });
        logger.info(`Target completed: ${targetId}`);
        res.json({ message: 'Target completed successfully', target: completedTarget });
    } catch (error) {
        logger.error('Target completion error:', error);
        res.status(500).json({ error: 'Failed to complete target' });
    }
});

// Delete a target
app.delete('/target/goals/:targetId', async (req, res) => {
    try {
        const { targetId } = req.params;
        const result = await pool.query(`DELETE FROM targets WHERE id = $1 RETURNING id, title`, [targetId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }
        const target = result.rows[0];
        await publishEvent('target.deleted', { targetId: target.id, title: target.title, timestamp: new Date() });
        logger.info(`Target deleted: ${targetId}`);
        res.json({ message: 'Target deleted successfully' });
    } catch (error) {
        logger.error('Target deletion error:', error);
        res.status(500).json({ error: 'Failed to delete target' });
    }
});

// --- NIEUWE ROUTE STAAT NU HIER (RUIM VOOR DE SERVER START) ---
app.post('/target/analyze-photo', async (req, res) => {
    const result = await breaker.fire(req.body);

// Zorg dat als de score-service een foutstatus zoals 404 teruggeeft, we die status en data doorgeven:
    if (result.status && result.status !== 200) {
        return res.status(result.status).json(result.data);
    }

    return res.json(result.data);
});

// Get target progress/statistics
app.get('/target/goals/:targetId/progress', async (req, res) => {
    try {
        const { targetId } = req.params;
        const targetResult = await pool.query(`SELECT * FROM targets WHERE id = $1`, [targetId]);
        if (targetResult.rows.length === 0) {
            return res.status(404).json({ error: 'Target not found' });
        }
        const target = targetResult.rows[0];
        const progressResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT p.id)::int as photo_count,
                COALESCE(AVG(s.final_score)::float, 0.0) as average_score,
                COALESCE(MAX(s.final_score)::float, 0.0) as highest_score,
                COALESCE(MIN(s.final_score)::float, 0.0) as lowest_score
             FROM photos p
             LEFT JOIN scores s ON p.id = s.photo_id
             WHERE p.user_id = $1`,
            [target.user_id]
        );
        const progress = progressResult.rows[0];
        const completion = {
            photoCount: target.target_photo_count ? Math.round((progress.photo_count / target.target_photo_count) * 100) : null,
            averageScore: target.target_score && progress.average_score ? Math.round((progress.average_score / target.target_score) * 100) : (target.target_score ? 0 : null)
        };
        res.json({ target: target, progress: progress, completion: completion });
    } catch (error) {
        logger.error('Progress fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

// Prometheus scrape endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error in target-service:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const startServer = async () => {
    try {
        await initRabbitMQ();
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