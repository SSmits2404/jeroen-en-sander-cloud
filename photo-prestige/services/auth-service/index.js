require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const { Pool } = require('pg');
const amqp = require('amqplib');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'auth-service.log' })
    ]
});

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message) } }));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use('/auth/', limiter);

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
            logger.info('RabbitMQ connected and exchange asserted');
            return;
        } catch (error) {
            logger.error(`RabbitMQ connection failed. Retries left: ${retries - 1}`, error);
            retries -= 1;
            await new Promise(res => setTimeout(res, 3000)); // Wacht 3 seconden voor de volgende poging
        }
    }
    logger.error('Could not connect to RabbitMQ, proceeding without event publishing capability.');
};

// Emit event to queue
const publishEvent = async (eventName, data) => {
    if (!channel) {
        logger.warn(`Event ${eventName} not published: RabbitMQ channel not available.`);
        return;
    }
    try {
        channel.publish(
            'photo-prestige',
            eventName,
            Buffer.from(JSON.stringify(data)),
            { persistent: true }
        );
        logger.info(`Event published: ${eventName}`);
    } catch (error) {
        logger.error('Event publish failed:', error);
    }
};

// ==================== ROUTES ====================

// Health checks (Both for internal Docker orchestration and gateway routing)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'auth-service', timestamp: new Date() });
});

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, role } = req.body;

        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Hash password
        const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
        const passwordHash = await bcryptjs.hash(password, saltRounds);

        // Insert user - Explicite 'active' status toegevoegd om 403 login blokkades te voorkomen
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, first_name, last_name, role, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, username, email, role, status, created_at`,
            [username, email, passwordHash, firstName || null, lastName || null, role || 'participant', 'active']
        );

        const user = result.rows[0];

        // Publish event
        await publishEvent('user.registered', {
            userId: user.id,
            email: user.email,
            username: user.username,
            timestamp: new Date()
        });

        logger.info(`User registered successfully: ${user.id}`);
        res.status(201).json({ message: 'User registered successfully', user });
    } catch (error) {
        logger.error('Registration error:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'User already exists' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    console.log("LOGIN HANDLER REACHED");
    console.log("JWT SECRET:", process.env.JWT_SECRET);
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Get user
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Verify password
        const passwordValid = await bcryptjs.compare(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({ error: `User account is not active (status: ${user.status || 'unknown'})` });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRATION || '24h' }
        );

        // Update last login
        await pool.query(
            'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        logger.info(`User logged in: ${user.id}`);
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify token endpoint
app.post('/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ valid: true, user: decoded });
    } catch (error) {
        logger.error('Token verification error:', error);
        res.status(401).json({ valid: false, error: 'Invalid token' });
    }
});

// Refresh token endpoint
app.post('/refresh', (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const newToken = jwt.sign(
            { userId: decoded.userId, email: decoded.email, role: decoded.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRATION || '24h' }
        );

        res.json({ token: newToken });
    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(401).json({ error: 'Token refresh failed' });
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
            logger.info(`Auth Service running on port ${PORT}`);
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