// services/score-service/imagga-client.js
// Imagga API wrapper for visual similarity search

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const logger = require('winston').createLogger();

const IMAGGA_API_URL = process.env.IMAGGA_API_URL || 'https://api.imagga.com/v2';
const IMAGGA_API_KEY = process.env.IMAGGA_API_KEY;
const IMAGGA_API_SECRET = process.env.IMAGGA_API_SECRET;
const IMAGGA_CATEGORIZER = 'general_v3';
const DISTANCE_THRESHOLD = parseFloat(process.env.IMAGGA_SIMILARITY_DISTANCE_THRESHOLD) || 1.4;

class ImaggaClient {
    constructor() {
        this.client = axios.create({
            baseURL: IMAGGA_API_URL,
            auth: {
                username: IMAGGA_API_KEY,
                password: IMAGGA_API_SECRET
            }
        });
    }

    /**
     * Feed an image to the visual search index
     * @param {string} imagePath - Path to image file
     * @param {string} imageId - Unique ID for the image
     * @param {string} indexName - Name of the index
     * @returns {Promise<object>}
     */
    async feedImage(imagePath, imageId, indexName) {
        try {
            const fileStream = fs.createReadStream(imagePath);
            const form = new FormData();
            form.append('image', fileStream);
            form.append('save_id', imageId);
            form.append('save_index', indexName);

            const response = await this.client.post(
                `/categories/${IMAGGA_CATEGORIZER}`,
                form,
                { headers: form.getHeaders() }
            );

            logger.info(`Image fed to index: ${imageId} -> ${indexName}`);
            return response.data;
        } catch (error) {
            logger.error('Feed image error:', error.message);
            throw error;
        }
    }

    /**
     * Train the visual search index
     * @param {string} indexName - Name of the index to train
     * @returns {Promise<string>} - Ticket ID for checking training status
     */
    async trainIndex(indexName) {
        try {
            const response = await this.client.put(
                `/similar-images/categories/${IMAGGA_CATEGORIZER}/${indexName}`
            );

            const ticketId = response.data.result.ticket_id;
            logger.info(`Index training started: ${indexName}, ticket: ${ticketId}`);
            return ticketId;
        } catch (error) {
            logger.error('Train index error:', error.message);
            throw error;
        }
    }

    /**
     * Check if index training is complete
     * @param {string} ticketId - Training ticket ID
     * @returns {Promise<boolean>} - true if training is complete
     */
    async isTrainingComplete(ticketId) {
        try {
            const response = await this.client.get(`/tickets/${ticketId}`);
            return response.data.result.is_final;
        } catch (error) {
            logger.error('Check training status error:', error.message);
            throw error;
        }
    }

    /**
     * Wait for index training to complete
     * @param {string} ticketId - Training ticket ID
     * @param {number} maxWaitMs - Maximum time to wait
     * @returns {Promise<boolean>}
     */
    async waitForTrainingComplete(ticketId, maxWaitMs = 600000) {
        const checkInterval = 500;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            const isComplete = await this.isTrainingComplete(ticketId);
            if (isComplete) {
                logger.info(`Index training completed: ${ticketId}`);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        throw new Error(`Training timeout for ticket ${ticketId}`);
    }

    /**
     * Query the similarity index with an image
     * @param {string} imagePath - Path to query image
     * @param {string} indexName - Name of the index to query
     * @returns {Promise<object>} - Similarity results
     */
    async queryIndex(imagePath, indexName) {
        try {
            const fileStream = fs.createReadStream(imagePath);
            const form = new FormData();
            form.append('image', fileStream);

            const response = await this.client.post(
                `/similar-images/categories/${IMAGGA_CATEGORIZER}/${indexName}?distance=${DISTANCE_THRESHOLD}`,
                form,
                { headers: form.getHeaders() }
            );

            return response.data;
        } catch (error) {
            logger.error('Query index error:', error.message);
            throw error;
        }
    }

    /**
     * Calculate similarity score from Imagga results
     * @param {object} imaggaResults - Results from queryIndex
     * @returns {object} - Processed results with scores
     */
    processResults(imaggaResults) {
        if (!imaggaResults.result || !imaggaResults.result.images) {
            return {
                similarity_percentage: 0,
                matched_images: [],
                distance_score: null
            };
        }

        const images = imaggaResults.result.images;
        if (images.length === 0) {
            return {
                similarity_percentage: 0,
                matched_images: [],
                distance_score: null
            };
        }

        // Best match (first result)
        const bestMatch = images[0];
        
        // Convert distance to similarity percentage
        // Distance 0 = 100% similar, Distance 1.4+ = low similarity
        const similarity_percentage = Math.max(0, 100 * (1 - (bestMatch.distance / 1.4)));

        return {
            similarity_percentage: Math.round(similarity_percentage * 100) / 100,
            matched_images: images.map(img => ({
                image_id: img.id,
                distance: img.distance,
                similarity: Math.max(0, 100 * (1 - (img.distance / 1.4)))
            })),
            distance_score: bestMatch.distance,
            raw_response: imaggaResults
        };
    }

    /**
     * Delete an index
     * @param {string} indexName - Name of the index to delete
     * @returns {Promise<object>}
     */
    async deleteIndex(indexName) {
        try {
            const response = await this.client.delete(
                `/similar-images/categories/${IMAGGA_CATEGORIZER}/${indexName}`
            );
            logger.info(`Index deleted: ${indexName}`);
            return response.data;
        } catch (error) {
            logger.error('Delete index error:', error.message);
            throw error;
        }
    }
}

module.exports = ImaggaClient;
