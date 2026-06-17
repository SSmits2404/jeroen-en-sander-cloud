# Getting Started - Photo Prestige

## Quick Start Guide

### Prerequisites
- Docker & Docker Compose installed
- Node.js 18+ (for local development)
- Imagga account (free signup)
- Postman or Insomnia (for API testing)

### Step 1: Clone and Setup

```bash
cd photo-prestige
cp .env.example .env
```

### Step 2: Configure Imagga Credentials

1. Go to: https://imagga.com/auth/signup/hacker
2. Create free account
3. Get API Key & Secret from: https://imagga.com/profile/dashboard
4. Add to `.env`:

```env
IMAGGA_API_KEY=your_api_key
IMAGGA_API_SECRET=your_api_secret
```

### Step 3: Start Services

```bash
# Start all services with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Check services are running
docker ps
```

### Step 4: Verify Setup

```bash
# Check each service health
curl http://localhost:3001/auth/health
curl http://localhost:3002/register/health
curl http://localhost:3003/target/health
curl http://localhost:3004/mail/health
curl http://localhost:3005/clock/health
curl http://localhost:3006/score/health
curl http://localhost:3007/read/health

# Should all return: {"status": "OK", "service": "..."}
```

## Testing with Postman

### Import Collection
See [postman/Photo-Prestige.postman_collection.json](../postman/Photo-Prestige.postman_collection.json)

### Test Flow

1. **Register User**
   ```
   POST /auth/register
   {
     "username": "test_user",
     "email": "test@example.com",
     "password": "test123",
     "role": "participant"
   }
   ```

2. **Login**
   ```
   POST /auth/login
   {
     "email": "test@example.com",
     "password": "test123"
   }
   Response contains JWT token - copy it!
   ```

3. **Set Token in Postman**
   - In Postman: `Manage Environments` → Create/Edit environment
   - Add: `token` = `<your_jwt_token>`

4. **Upload Target (as Target Owner)**
   ```
   First register as: role: "target_owner"
   
   POST /targets/upload
   - Select a photo file
   - Add metadata
   ```

5. **Get Active Competitions**
   ```
   GET /read/competitions/active
   ```

6. **Submit Participation Photo**
   ```
   POST /submissions/upload
   - Select a photo file
   ```

## Local Development (without Docker)

### Terminal 1: PostgreSQL
```bash
# Using Docker for DB only
docker run -d \
  --name pg-dev \
  -e POSTGRES_PASSWORD=postgres123 \
  -e POSTGRES_DB=photo_prestige \
  -p 5432:5432 \
  postgres:15-alpine

# Run schema
psql -U postgres -d photo_prestige -f config/schema.sql
```

### Terminal 2: RabbitMQ
```bash
docker run -d \
  --name rabbitmq-dev \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3.12-management-alpine
```

### Terminal 3+: Start Each Service
```bash
cd services/auth-service
npm install
npm run dev
```

Repeat for each service in separate terminals.

## Database Access

### Connect to PostgreSQL
```bash
psql -U postgres -d photo_prestige -h localhost
```

### Useful Queries
```sql
-- List all users
SELECT id, username, email, role FROM users;

-- List active competitions
SELECT * FROM competitions WHERE status = 'active';

-- View leaderboard for competition
SELECT u.username, s.similarity_percentage, s.final_score
FROM scores s
JOIN users u ON s.participant_id = u.id
WHERE s.competition_id = 'COMP_ID'
ORDER BY s.final_score DESC;
```

## RabbitMQ Management UI

Access at: http://localhost:15672
- Username: guest
- Password: guest

View messages, queues, and exchanges in real-time.

## Troubleshooting

### Services won't start
```bash
# Check logs
docker-compose logs <service-name>

# Ensure database is ready
docker-compose exec postgres pg_isready -U postgres

# Restart everything
docker-compose down
docker-compose up -d
```

### "Connection refused" errors
- Wait 30 seconds for services to fully start
- Check health endpoints: `http://localhost:PORT/health`

### JWT token errors
- Token expires after 24 hours
- Login again to get new token
- Check expiration in `.env`: `JWT_EXPIRATION`

### Imagga API errors
- Verify credentials in `.env`
- Check API limits: https://imagga.com/profile/dashboard
- Free tier: 1000 calls/month

## Next Steps

1. Read [API Documentation](./docs/API.md)
2. Review [Imagga Integration Guide](./docs/IMAGGA.md)
3. Check [Database Schema](./config/schema.sql)
4. Explore microservice code in `services/*/index.js`

## Development Tips

### Add Debug Logging
```env
DEBUG=*
```

### Monitor Service Logs
```bash
docker-compose logs -f <service-name>
```

### Restart a Single Service
```bash
docker-compose restart <service-name>
```

### View Network
```bash
docker network inspect photo-prestige-network
```

### Execute Commands in Container
```bash
docker-compose exec <service-name> npm test
```

## Deployment Checklist

- [ ] Update all `.env` with production credentials
- [ ] Set `NODE_ENV=production`
- [ ] Change `JWT_SECRET` to strong random value
- [ ] Configure cloud storage for images (optional)
- [ ] Set up CI/CD pipeline
- [ ] Enable monitoring and logging
- [ ] Configure backups for database
- [ ] Load testing completed
- [ ] Security audit completed

## Support & Resources

- **Documentation:** See `/docs` folder
- **Imagga Docs:** https://docs.imagga.com
- **Express.js:** https://expressjs.com
- **PostgreSQL:** https://www.postgresql.org/docs
- **RabbitMQ:** https://www.rabbitmq.com/documentation.html
