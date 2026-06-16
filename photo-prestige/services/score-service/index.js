// services/score-service/index.js
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
const imagga = new ImaggaClient();

let channel;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));

// Initialize RabbitMQ
const initRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertExchange('photo-prestige', 'topic', { durable: true });
        
        // Subscribe to events
        const q = await channel.assertQueue('score-service', { durable: true });
        await channel.bindQueue(q.queue, 'photo-prestige', 'target.uploaded');
        await channel.bindQueue(q.queue, 'photo-prestige', 'submission.received');
        
        channel.consume(q.queue, handleEvent);
        logger.info('RabbitMQ connected and listening');
    } catch (error) {
        logger.error('RabbitMQ init error:', error);
    }
};

const handleEvent = (msg) => {
    if (!msg) return;
    
    try {
        const content = JSON.parse(msg.content.toString());
        logger.info('Event received:', content);
        
        if (msg.fields.routingKey === 'submission.received') {
            processSubmission(content);
        }
    } catch (error) {
        logger.error('Event handling error:', error);
    }
    
    channel.ack(msg);
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
        logger.error('Event publish error:', error);
    }
};

// ==================== ROUTES ====================

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'score-service' });
});

/**
 * Calculate score for a submission
 * POST /scores/calculate
 * Body: { competitionId, submissionId, targetImagePath, submissionImagePath }
 */
app.post('/scores/calculate', async (req, res) => {
    try {
        const { competitionId, submissionId, targetImagePath, submissionImagePath } = req.body;

        // Get competition details
        const compResult = await pool.query(
            `SELECT * FROM competitions WHERE id = $1`,
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

        // Query similarity
        const imaggaResults = await imagga.queryIndex(
            submissionImagePath,
            indexMapping.imagga_index_name
        );

        const processedResults = imagga.processResults(imaggaResults);

        // Get submission details
        const submResult = await pool.query(
            `SELECT * FROM submissions WHERE id = $1`,
            [submissionId]
        );

        const submission = submResult.rows[0];

        // Calculate final score
        // Formula: (1 - (time_ratio * 0.5)) * similarity_percentage
        const competitionDurationMs = new Date(competition.end_time) - new Date(competition.start_time);
        const submissionTimeMs = new Date(submission.uploaded_at) - new Date(competition.start_time);
        const timeRatio = submissionTimeMs / competitionDurationMs;
        
        const finalScore = (1 - (timeRatio * 0.5)) * processedResults.similarity_percentage;

        // Store score
        const scoreResult = await pool.query(
            `INSERT INTO scores 
             (competition_id, submission_id, participant_id, similarity_percentage, 
              distance_score, final_score, matching_images, score_formula)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                competitionId,
                submissionId,
                submission.participant_id,
                processedResults.similarity_percentage,
                processedResults.distance_score,
                finalScore,
                JSON.stringify(processedResults.matched_images),
                `(1 - (${timeRatio.toFixed(4)} * 0.5)) * ${processedResults.similarity_percentage.toFixed(2)}`
            ]
        );

        const score = scoreResult.rows[0];

        // Update submission status
        await pool.query(
            `UPDATE submissions SET status = 'scored' WHERE id = $1`,
            [submissionId]
        );

        // Publish event
        await publishEvent('score.calculated', {
            scoreId: score.id,
            submissionId,
            competitionId,
            similarityPercentage: score.similarity_percentage,
            finalScore: score.final_score,
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

        const result = await pool.query(
            `SELECT s.*, u.username, u.profile_image_url
             FROM scores s
             INNER JOIN users u ON s.participant_id = u.id
             WHERE s.competition_id = $1
             ORDER BY s.final_score DESC, s.calculated_at ASC`,
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
 * Body: { competitionId, targetImagePath }
 */
app.post('/scores/train-index', async (req, res) => {
    try {
        const { competitionId, targetImagePath } = req.body;

        // Get or create index mapping
        let indexMapping = await pool.query(
            `SELECT * FROM imagga_index_mappings WHERE competition_id = $1`,
            [competitionId]
        );

        let indexName = `photo_prestige_${competitionId}`;
        let mappingId;

        if (indexMapping.rows.length === 0) {
            // Create new mapping
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

        // Wait for training (async)
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
        }).catch(error => {
            logger.error('Training completion error:', error);
        });

        res.json({ message: 'Training started', ticketId, indexName });
    } catch (error) {
        logger.error('Train index error:', error);
        res.status(500).json({ error: 'Index training failed' });
    }
});

app.listen(PORT, async () => {
    await initRabbitMQ();
    logger.info(`Score Service running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
    await pool.end();
    process.exit(0);
});
