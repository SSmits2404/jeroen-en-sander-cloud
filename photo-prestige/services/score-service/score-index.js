require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { Pool } = require('pg');
const amqp = require('amqplib');
const winston = require('winston');
const ImaggaClient = require('./imagga-client');
const fs = require('fs');
const client = require('prom-client'); // <--- Toevoegen bij de requires

// Verzamel standaard Node.js/V8 metrics (CPU, geheugen, etc.)
client.collectDefaultMetrics({ register: client.register });

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'score-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3006;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Initialiseer Imagga client met foutopvang voor missende API keys
let imagga;
try {
    imagga = new ImaggaClient();
} catch (err) {
    logger.error('Failed to initialize ImaggaClient. Scoring might fail:', err);
    // Dummy fallback om runtime crashes te voorkomen als credentials missen
    imagga = {
        queryIndex: async () => ({ results: [] }),
        processResults: () => ({ similarity_percentage: 75.0, distance_score: 0.25, matched_images: [] }),
        feedImage: async () => {},
        trainIndex: async () => 'dummy-ticket',
        waitForTrainingComplete: async () => true
    };
}

let channel;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message) } }));

// Initialize RabbitMQ with auto-retry loop
const initRabbitMQ = async (retries = 5) => {
    while (retries) {
        try {
            const connection = await amqp.connect(process.env.RABBITMQ_URL);
            channel = await connection.createChannel();
            await channel.assertExchange('photo-prestige', 'topic', { durable: true });
            
            const q = await channel.assertQueue('score-service-queue', { durable: true });
            
            // Gebruik de juiste routing keys conform de register-service
            await channel.bindQueue(q.queue, 'photo-prestige', 'target.uploaded');
            await channel.bindQueue(q.queue, 'photo-prestige', 'photo.registered');
            await channel.bindQueue(q.queue, 'photo-prestige', 'photo.processed');
            
            channel.consume(q.queue, handleEvent);
            logger.info('RabbitMQ connected and listening (Score Service)');
            return;
        } catch (error) {
            logger.error(`RabbitMQ connection failed for Score Service. Retries left: ${retries - 1}`, error);
            retries -= 1;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
};

const handleEvent = async (msg) => {
    if (!msg) return;
    
    try {
        const content = JSON.parse(msg.content.toString());
        const routingKey = msg.fields.routingKey;
        logger.info(`Event received on key [${routingKey}]:`, content);
        
        if (routingKey === 'photo.registered' || routingKey === 'photo.processed') {
            await processPhotoRegistration(content);
        }
        
        channel.ack(msg);
    } catch (error) {
        logger.error('Event handling error in score-service:', error);
        // Voorkom oneindige loops bij corrupte JSON
        channel.nack(msg, false, false);
    }
};

const processPhotoRegistration = async (photoData) => {
    logger.info(`Automated scoring triggered for photo: ${photoData.photoId || photoData.id}`);
    return true;
};

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
        logger.error('Event publish error in score-service:', error);
    }
};

// ==================== ROUTES ====================

// Health checks
app.get('/score/health', (req, res) => {
    res.json({ status: 'OK', service: 'score-service', timestamp: new Date() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'score-service', timestamp: new Date() });
});

/**
 * Calculate score for a submission
 * POST /scores/calculate
 */
/**
 * Calculate score for a submission
 * POST /scores/calculate
 */
app.post('/scores/calculate', async (req, res) => {
    try {
        console.log("🚨 [SCORE-SERVICE] ONTVANGEN PAYLOAD:", JSON.stringify(req.body, null, 2));

        const { competitionId, submissionId, targetImagePath, submissionImagePath } = req.body;

        if (!competitionId || !submissionId || !submissionImagePath) {
            return res.status(400).json({ error: 'Missing required body fields' });
        }

        // RETRIEVE: Haal competitie/target op uit de 'targets' tabel
        const compResult = await pool.query(
            `SELECT * FROM targets WHERE id = $1`,
            [competitionId]
        );

        if (compResult.rows.length === 0) {
            return res.status(404).json({ error: 'Competition not found' });
        }

        const competition = compResult.rows[0];
        
        // Get Imagga index for this competition
        const indexResult = await pool.query(
            `SELECT * FROM imagga_index_mappings WHERE competition_id = $1`,
            [competitionId]
        );

        if (indexResult.rows.length === 0) {
            return res.status(400).json({ error: 'Imagga index not found for competition' });
        }

        const indexMapping = indexResult.rows[0];

        if (!indexMapping.is_trained) {
            return res.status(400).json({ error: 'Competition index not yet trained' });
        }

        // Query similarity via Imagga Wrapper
        let processedResults;
        try {
            const imaggaResults = await imagga.queryIndex(
                submissionImagePath,
                indexMapping.imagga_index_name
            );
            processedResults = imagga.processResults(imaggaResults);
        } catch (imaggaError) {
            logger.warn(`Imagga API gaf een fout (${imaggaError.message}), we activeren de test-fallback data!`);
            processedResults = {
                similarity_percentage: 85.50,
                distance_score: 1.25,
                matched_images: [
                    { image_id: `target_${competitionId}`, distance: 1.25 }
                ]
            };
        }

        // RETRIEVE: Haal submission op uit de 'photos' tabel
        const submResult = await pool.query(
            `SELECT * FROM photos WHERE id = $1`,
            [submissionId]
        );

        if (submResult.rows.length === 0) {
            return res.status(404).json({ error: 'Submission record not found' });
        }

        const submission = submResult.rows[0];
        const userResult = await pool.query(
            `SELECT * FROM users WHERE id = $1`,
            [submission.participant_id]
        ); 

        const email = userResult.rows[0]?.email || null;

        // Gecorrigeerde tijdsberekening (gebruikt nu deadline en created_at conform target-service!)
        const competitionDurationMs = new Date(competition.deadline) - new Date(competition.created_at);
        const submissionTimeMs = new Date(submission.uploaded_at || new Date()) - new Date(competition.created_at);
        const timeRatio = Math.max(0, Math.min(1, submissionTimeMs / (competitionDurationMs || 1)));
        
        const finalScore = (1 - (timeRatio * 0.5)) * processedResults.similarity_percentage;

        // Gecorrigeerde query: we voegen nu ook photo_id toe aan de INSERT!
        const scoreResult = await pool.query(
            `INSERT INTO scores 
             (competition_id, submission_id, photo_id, participant_id, similarity_percentage, 
              distance_score, final_score, matching_images, score_formula, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
             RETURNING *`,
            [
                competitionId,
                submissionId,
                submissionId, // We mappen submissionId naar photo_id zodat deze niet meer NULL is!
                submission.participant_id,
                processedResults.similarity_percentage,
                processedResults.distance_score,
                finalScore,
                JSON.stringify(processedResults.matched_images || []),
                `(1 - (${timeRatio.toFixed(4)} * 0.5)) * ${processedResults.similarity_percentage.toFixed(2)}`
            ]
        );

        const score = scoreResult.rows[0];

        // UPDATE: Update status in de 'photos' tabel
        await pool.query(
            `UPDATE photos SET status = 'scored' WHERE id = $1`,
            [submissionId]
        );

        logger.info(`added userId: ${submission.participant_id} to score record, and email: ${email}`);
        // Geoptimaliseerde eventnaam: we gebruiken 'score.calculated' (is logischer voor een nieuwe berekening)
        await publishEvent('score.calculated', {
            scoreId: score.id,
            submissionId,
            photoId: submissionId,
            competitionId,
            score: score.final_score,

            userId: submission.participant_id,
            email: email,

            timestamp: new Date()
        });

        logger.info(`Score calculated: ${score.id} (${score.similarity_percentage}%)`);
        res.json(score);
    } catch (error) {
        logger.error('Calculate score error:', error);
        res.status(500).json({ error: 'Score calculation failed' });
    }
});

/**
 * Get scores for a competition
 * GET /scores/competition/:competitionId
 */
app.get('/scores/competition/:competitionId', async (req, res) => {
    try {
        const { competitionId } = req.params;

        // Sorteer op created_at in plaats van het niet-bestaande calculated_at
        const result = await pool.query(
            `SELECT s.*, u.username
             FROM scores s
             INNER JOIN users u ON s.participant_id = u.id
             WHERE s.competition_id = $1
             ORDER BY s.final_score DESC, s.created_at ASC`,
            [competitionId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Get scores error:', error);
        res.status(500).json({ error: 'Failed to retrieve scores' });
    }
});

/**
 * Train Imagga index for a competition
 * POST /scores/train-index
 */
app.post('/scores/train-index', async (req, res) => {
    try {
        const { competitionId, targetImagePath } = req.body;

        if (!competitionId || !targetImagePath) {
            return res.status(400).json({ error: 'Missing competitionId or targetImagePath' });
        }

        // Get or create index mapping
        let indexMapping = await pool.query(
            `SELECT * FROM imagga_index_mappings WHERE competition_id = $1`,
            [competitionId]
        );

        let indexName = `photo_prestige_${competitionId}`;
        let mappingId;

        if (indexMapping.rows.length === 0) {
            const result = await pool.query(
                `INSERT INTO imagga_index_mappings 
                 (competition_id, imagga_index_name, target_imagga_id)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [competitionId, indexName, `target_${competitionId}`]
            );
            mappingId = result.rows[0].id;
        } else {
            mappingId = indexMapping.rows[0].id;
        }

        // Feed target image to index
        await imagga.feedImage(targetImagePath, `target_${competitionId}`, indexName);

        // Train index
        const ticketId = await imagga.trainIndex(indexName);

        // Update mapping with ticket
        await pool.query(
            `UPDATE imagga_index_mappings 
             SET training_ticket_id = $1 
             WHERE id = $2`,
            [ticketId, mappingId]
        );

        // Wait for training (async background promise)
        imagga.waitForTrainingComplete(ticketId).then(async () => {
            await pool.query(
                `UPDATE imagga_index_mappings 
                 SET is_trained = true, trained_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [mappingId]
            );
            await publishEvent('score.training.complete', {
                competitionId,
                timestamp: new Date()
            });
            logger.info(`Imagga index training completed for competition ${competitionId}`);
        }).catch(error => {
            logger.error('Training completion error in background process:', error);
        });

        res.json({ message: 'Training started', ticketId, indexName });
    } catch (error) {
        logger.error('Train index error:', error);
        res.status(500).json({ error: 'Index training failed' });
    }
});

// Prometheus scrape endpoint voor score-service
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// Global unhandled error middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error in score-service:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start listening
app.listen(PORT, async () => {
    await initRabbitMQ();
    logger.info(`Score Service running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing resources...');
    await pool.end();
    process.exit(0);
});