// shared/constants.js
// Global constants for Photo Prestige application

module.exports = {
    // Service Ports
    SERVICES: {
        AUTH: { name: 'auth-service', port: 3001 },
        REGISTER: { name: 'register-service', port: 3002 },
        TARGET: { name: 'target-service', port: 3003 },
        MAIL: { name: 'mail-service', port: 3004 },
        CLOCK: { name: 'clock-service', port: 3005 },
        SCORE: { name: 'score-service', port: 3006 },
        READ: { name: 'read-service', port: 3007 },
    },

    // User Roles
    ROLES: {
        PARTICIPANT: 'participant',
        TARGET_OWNER: 'target_owner',
        ADMIN: 'admin'
    },

    // User Status
    USER_STATUS: {
        ACTIVE: 'active',
        INACTIVE: 'inactive',
        SUSPENDED: 'suspended'
    },

    // Competition Status
    COMPETITION_STATUS: {
        PLANNED: 'planned',
        ACTIVE: 'active',
        CLOSED: 'closed',
        CANCELLED: 'cancelled'
    },

    // Submission Status
    SUBMISSION_STATUS: {
        SUBMITTED: 'submitted',
        SCORED: 'scored',
        REJECTED: 'rejected'
    },

    // Email Types
    EMAIL_TYPES: {
        VERIFICATION: 'verification',
        SCORE_UPDATE: 'score_update',
        WINNER_ANNOUNCEMENT: 'winner',
        REMINDER: 'reminder',
        REGISTRATION_CONFIRMATION: 'registration_confirmation'
    },

    // Notification Types
    NOTIFICATION_TYPES: {
        SCORE_UPDATE: 'score_update',
        WINNER: 'winner',
        REMINDER: 'reminder',
        COMPETITION_STARTED: 'competition_started',
        COMPETITION_CLOSED: 'competition_closed'
    },

    // RabbitMQ Event Names
    EVENTS: {
        USER_REGISTERED: 'user.registered',
        TARGET_UPLOADED: 'target.uploaded',
        SUBMISSION_RECEIVED: 'submission.received',
        SCORE_CALCULATED: 'score.calculated',
        COMPETITION_STARTED: 'competition.started',
        COMPETITION_CLOSED: 'competition.closed',
        WINNER_DETERMINED: 'winner.determined',
        REMINDER_NEEDED: 'reminder.needed',
        SCORE_NOTIFIED: 'score.notified'
    },

    // HTTP Status Codes
    HTTP_STATUS: {
        OK: 200,
        CREATED: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        INTERNAL_SERVER_ERROR: 500
    },

    // Image Validation
    IMAGE_CONFIG: {
        MAX_SIZE_BYTES: 52428800, // 50MB
        ALLOWED_EXTENSIONS: ['jpg', 'jpeg', 'png', 'webp'],
        ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp']
    },

    // Imagga Configuration
    IMAGGA: {
        API_URL: 'https://api.imagga.com/v2',
        CATEGORIZER: 'general_v3',
        DISTANCE_THRESHOLD: 1.4,
        DEFAULT_INDEX_PREFIX: 'photo_prestige_',
        TRAINING_CHECK_INTERVAL_MS: 500,
        TRAINING_TIMEOUT_MS: 600000 // 10 minutes
    },

    // Competition Settings
    COMPETITION: {
        DEFAULT_DURATION_HOURS: 24,
        MIN_SIMILARITY_SCORE: 70,
        DEFAULT_SEARCH_RADIUS_METERS: 100,
        REMINDER_INTERVAL_HOURS: 1
    },

    // JWT
    JWT: {
        ALGORITHM: 'HS256',
        EXPIRATION: '24h'
    },

    // Scoring Formula
    SCORING: {
        // Final Score = (1 - (time_ratio * 0.5)) * similarity_percentage
        // time_ratio = time_submitted / competition_duration
        TIME_WEIGHT: 0.5,
        SIMILARITY_WEIGHT: 1.0
    },

    // Error Messages
    ERRORS: {
        AUTH_FAILED: 'Authentication failed',
        UNAUTHORIZED: 'Unauthorized access',
        USER_NOT_FOUND: 'User not found',
        INVALID_TOKEN: 'Invalid or expired token',
        INVALID_INPUT: 'Invalid input provided',
        COMPETITION_NOT_FOUND: 'Competition not found',
        COMPETITION_CLOSED: 'Competition is closed',
        SUBMISSION_FAILED: 'Submission failed',
        IMAGE_INVALID: 'Invalid image file',
        IMAGGA_ERROR: 'Image analysis service error',
        DATABASE_ERROR: 'Database operation failed'
    }
};
